import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  BucketRowSchema,
  LatestCheckRowSchema,
  MonitorCheckError,
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

export const HttpClientLive = FetchHttpClient.layer;

export const makeStatus = Effect.fn("Status.make")(function* ({
  config,
}: {
  readonly config: StatusConfig;
}) {
  const sql = yield* SqlClient.SqlClient;
  const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);

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
      return;
    }

    const ok = result.success === monitor.expectedStatus ? 1 : 0;
    yield* sql`
      INSERT INTO checks (monitor_id, checked_at, ok, status_code, latency_ms, error)
      VALUES (${monitor.id}, ${checkedAt}, ${ok}, ${result.success}, ${latency}, NULL)
    `;
  });

  const checkAll = Effect.fn("Status.checkAll")(function* () {
    yield* Effect.forEach(config.monitors, (monitor) => runCheck({ monitor }), {
      concurrency: 5,
      discard: true,
    });
    const now = yield* Clock.currentTimeMillis;
    yield* sql`DELETE FROM checks WHERE checked_at < ${now - 91 * DAY}`;
  });

  return { loadSnapshot, checkAll };
});
