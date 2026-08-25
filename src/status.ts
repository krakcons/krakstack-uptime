import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { shouldAlert, type StatusAlert } from "./alerts.ts";
import {
  AlertStateRowSchema,
  BucketRowSchema,
  LatestCheckRowSchema,
  MonitorCheckError,
  PendingAlertRowSchema,
  type MonitorConfig,
  type MonitorRow,
  type Snapshot,
  type StatusConfig,
} from "./schema.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const decodeLatestChecks = Schema.decodeUnknownEffect(
  Schema.Array(LatestCheckRowSchema),
);
const decodeBucketRows = Schema.decodeUnknownEffect(
  Schema.Array(BucketRowSchema),
);
const decodeAlertStateRows = Schema.decodeUnknownEffect(
  Schema.Array(AlertStateRowSchema),
);
const decodePendingAlertRows = Schema.decodeUnknownEffect(
  Schema.Array(PendingAlertRowSchema),
);

export const HttpClientLive = FetchHttpClient.layer;

export const makeStatus = Effect.fn("Status.make")(function* ({
  config,
}: {
  readonly config: StatusConfig;
}) {
  const sql = yield* SqlClient.SqlClient;
  const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
  const monitorsById = new Map(
    config.monitors.map((monitor) => [monitor.id, monitor]),
  );

  const recordAlertTransition = Effect.fn("Status.recordAlertTransition")(
    function* ({
      monitorId,
      ok,
      checkedAt,
    }: {
      readonly monitorId: string;
      readonly ok: 0 | 1;
      readonly checkedAt: number;
    }) {
      const states = yield* sql`
        SELECT ok
        FROM monitor_alert_state
        WHERE monitor_id = ${monitorId}
        LIMIT 1
      `.pipe(Effect.flatMap(decodeAlertStateRows));
      const previous = states[0]?.ok;
      if (previous === ok) return;

      yield* sql`
        INSERT INTO monitor_alert_state (monitor_id, ok, updated_at)
        VALUES (${monitorId}, ${ok}, ${checkedAt})
        ON CONFLICT (monitor_id) DO UPDATE SET
          ok = excluded.ok,
          updated_at = excluded.updated_at
      `;
      if (!config.alerts || !shouldAlert(previous, ok)) return;

      yield* sql`
        INSERT INTO alert_outbox (monitor_id, ok, created_at)
        VALUES (${monitorId}, ${ok}, ${checkedAt})
      `;
    },
  );

  const loadSnapshot = Effect.fn("Status.loadSnapshot")(function* () {
    const latest = yield* sql`
      SELECT c.monitor_id, c.ok, c.checked_at, c.latency_ms
      FROM checks c
      INNER JOIN (
        SELECT monitor_id, MAX(id) AS id
        FROM checks
        GROUP BY monitor_id
      ) recent ON recent.id = c.id
    `.pipe(Effect.flatMap(decodeLatestChecks));
    const latestByMonitor = new Map(
      latest.map((check) => [check.monitor_id, check]),
    );
    const monitors: ReadonlyArray<MonitorRow> = config.monitors.map(
      (monitor) => {
        const check = latestByMonitor.get(monitor.id);
        return {
          id: monitor.id,
          group: monitor.group,
          name: monitor.name,
          url: monitor.url.toString(),
          method: monitor.method,
          expected_status: monitor.expectedStatus,
          timeout_ms: monitor.timeoutMs,
          active: 1,
          last_ok: check?.ok ?? null,
          last_checked_at: check?.checked_at ?? null,
          last_latency_ms: check?.latency_ms ?? null,
        };
      },
    );
    const now = yield* Clock.currentTimeMillis;
    const minutes = yield* sql`
      SELECT monitor_id, CAST(checked_at / ${MINUTE} AS INTEGER) AS bucket,
        SUM(ok) AS successful, COUNT(*) AS total
      FROM checks
      WHERE checked_at >= ${(Math.floor(now / MINUTE) - 89) * MINUTE}
      GROUP BY monitor_id, bucket
    `.pipe(Effect.flatMap(decodeBucketRows));
    const hours = yield* sql`
      SELECT monitor_id, CAST(checked_at / ${HOUR} AS INTEGER) AS bucket,
        SUM(ok) AS successful, COUNT(*) AS total
      FROM checks
      WHERE checked_at >= ${(Math.floor(now / HOUR) - 89) * HOUR}
      GROUP BY monitor_id, bucket
    `.pipe(Effect.flatMap(decodeBucketRows));
    const days = yield* sql`
      SELECT monitor_id, CAST(checked_at / ${DAY} AS INTEGER) AS bucket,
        SUM(ok) AS successful, COUNT(*) AS total
      FROM checks
      WHERE checked_at >= ${(Math.floor(now / DAY) - 89) * DAY}
      GROUP BY monitor_id, bucket
    `.pipe(Effect.flatMap(decodeBucketRows));
    return { monitors, minutes, hours, days } satisfies Snapshot;
  });

  const runCheck = Effect.fn("Status.runCheck")(function* ({
    monitor,
  }: {
    readonly monitor: MonitorConfig;
  }) {
    const started = yield* Clock.monotonicTimeNanos;
    const request = HttpClientRequest.make(monitor.method)(monitor.url, {
      headers: { "user-agent": "KrakstackUptime/1.0" },
    });
    const result = yield* Effect.scoped(
      httpClient.execute(request).pipe(
        Effect.timeout(Duration.millis(monitor.timeoutMs)),
        Effect.map((response) => response.status),
        Effect.mapError(
          (cause) => new MonitorCheckError({ message: String(cause), cause }),
        ),
      ),
    ).pipe(Effect.result);
    const finished = yield* Clock.monotonicTimeNanos;
    const checkedAt = yield* Clock.currentTimeMillis;
    const latency = Math.round(
      Duration.toMillis(Duration.nanos(finished - started)),
    );

    if (result._tag === "Failure") {
      yield* sql`
        INSERT INTO checks (monitor_id, checked_at, ok, status_code, latency_ms, error)
        VALUES (${monitor.id}, ${checkedAt}, 0, NULL, ${latency}, ${result.failure.message})
      `;
      yield* recordAlertTransition({ monitorId: monitor.id, ok: 0, checkedAt });
      return;
    }

    const ok = result.success === monitor.expectedStatus ? 1 : 0;
    yield* sql`
      INSERT INTO checks (monitor_id, checked_at, ok, status_code, latency_ms, error)
      VALUES (${monitor.id}, ${checkedAt}, ${ok}, ${result.success}, ${latency}, NULL)
    `;
    yield* recordAlertTransition({ monitorId: monitor.id, ok, checkedAt });
  });

  const checkAll = Effect.fn("Status.checkAll")(function* () {
    yield* Effect.forEach(config.monitors, (monitor) => runCheck({ monitor }), {
      concurrency: 5,
      discard: true,
    });
    const now = yield* Clock.currentTimeMillis;
    yield* sql`DELETE FROM checks WHERE checked_at < ${now - 91 * DAY}`;
    yield* sql`
      DELETE FROM alert_outbox
      WHERE sent_at IS NOT NULL AND sent_at < ${now - 91 * DAY}
    `;

    const pending = yield* sql`
      SELECT id, monitor_id, ok, created_at
      FROM alert_outbox
      WHERE sent_at IS NULL
      ORDER BY id
    `.pipe(Effect.flatMap(decodePendingAlertRows));
    return pending.flatMap((alert): ReadonlyArray<StatusAlert> => {
      const monitor = monitorsById.get(alert.monitor_id);
      return monitor
        ? [
            {
              ...alert,
              group: monitor.group,
              name: monitor.name,
              url: monitor.url.toString(),
            },
          ]
        : [];
    });
  });

  const markAlertSent = Effect.fn("Status.markAlertSent")(function* ({
    id,
  }: {
    readonly id: number;
  }) {
    const sentAt = yield* Clock.currentTimeMillis;
    yield* sql`
      UPDATE alert_outbox
      SET sent_at = ${sentAt}
      WHERE id = ${id}
    `;
  });

  return { loadSnapshot, checkAll, markAlertSent };
});
