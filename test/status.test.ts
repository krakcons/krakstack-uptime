import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { nextConfirmedStatus, retryMonitorCheck } from "../src/status.ts";

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
