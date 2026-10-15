import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlClient from "effect/sql/SqlClient";
import * as Statement from "effect/sql/Statement";
import { StatusConfigSchema } from "../src/schema.ts";
import {
  makeStatus,
  nextConfirmedStatus,
  retryMonitorCheck,
} from "../src/status.ts";

describe("nextConfirmedStatus", () => {
  it("keeps a service operational after one failed minute", () => {
    expect(nextConfirmedStatus(1, 0, [0, 1])).toBe(1);
  });

  it("confirms an outage after two failed minutes", () => {
    expect(nextConfirmedStatus(1, 0, [0, 0])).toBe(0);
  });

  it("recovers after one successful check", () => {
    expect(nextConfirmedStatus(0, 1, [1, 0])).toBe(1);
  });
});

it.effect("retries a failed monitor check twice", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const result = yield* retryMonitorCheck(
      Ref.updateAndGet(attempts, (count) => count + 1).pipe(
        Effect.flatMap((count) =>
          count < 3 ? Effect.fail("timeout") : Effect.succeed("ok"),
        ),
      ),
    );

    expect(result).toBe("ok");
    expect(yield* Ref.get(attempts)).toBe(3);
  }),
);

const config = Schema.decodeUnknownSync(StatusConfigSchema)({
  siteName: { label: "Test", en: "Status", fr: "Statut" },
  monitors: Array.from({ length: 6 }, (_, index) => ({
    id: `monitor-${index}`,
    group: "Apps",
    name: `Monitor ${index}`,
    url: "https://example.com",
    method: "GET",
    expectedStatus: 200,
    timeoutMs: 10000,
  })),
});

for (const scheduledTime of [undefined, 60_000]) {
  it.effect(
    `buckets the entire batch by ${scheduledTime === undefined ? "start" : "scheduled"} time despite delayed checks`,
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(120_000);
        const queries: Array<{ sql: string; params: ReadonlyArray<unknown> }> =
          [];
        const execute = (sql: string, params: ReadonlyArray<unknown>) =>
          Effect.sync(() => {
            queries.push({ sql, params });
            return [];
          });
        const sql = yield* SqlClient.make({
          acquirer: Effect.succeed({
            execute,
            executeRaw: execute,
            executeUnprepared: execute,
            executeValues: execute,
            executeValuesUnprepared: execute,
            executeStream: () => Stream.empty,
          }),
          compiler: Statement.makeCompilerSqlite(),
          spanAttributes: [],
        }).pipe(Effect.provide(Reactivity.layer));
        const httpClient = HttpClient.make((request) =>
          TestClock.adjust(60_000).pipe(
            Effect.as(
              HttpClientResponse.fromWeb(
                request,
                new Response(null, { status: 200 }),
              ),
            ),
          ),
        );
        const status = yield* makeStatus({ config }).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.provideService(HttpClient.HttpClient, httpClient),
        );

        yield* status.checkAll(scheduledTime);

        const inserts = queries.filter((query) =>
          query.sql.includes("INSERT OR REPLACE INTO monitor_latest_check"),
        );
        expect(inserts).toHaveLength(6);
        for (const insert of inserts) {
          expect(insert.params[2]).toBe(scheduledTime ?? 120_000);
        }

        yield* status.loadSnapshot();
        const minuteQuery = queries.find(
          (query) =>
            query.sql.includes("SELECT monitor_id, bucket") &&
            query.params[0] === 60_000,
        );
        expect(minuteQuery?.sql).toContain("AND bucket <");
        expect(
          Number(minuteQuery?.params[2]) - Number(minuteQuery?.params[1]),
        ).toBe(90);
      }),
  );
}
