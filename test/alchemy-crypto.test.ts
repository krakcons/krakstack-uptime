import { NodeCrypto } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { makeOAuthClient } from "alchemy/Auth/OAuthFlow";
import * as Effect from "effect/Effect";
import { SecureRandom } from "effect/crypto";
import { makeOAuthClient as makeCompiledOAuthClient } from "../node_modules/alchemy/lib/Auth/OAuthFlow.js";

describe("Alchemy Effect crypto compatibility patch", () => {
  for (const { name, make } of [
    { name: "TypeScript source", make: makeOAuthClient },
    { name: "compiled JavaScript", make: makeCompiledOAuthClient },
  ]) {
    it.effect(`${name} preserves OAuth PKCE SHA-256 and opaque state`, () =>
      Effect.gen(function* () {
        const random = yield* SecureRandom.SecureRandom;
        const client = make({
          clientId: "test-client",
          endpoints: {
            authorize: "https://example.com/authorize",
            token: "https://example.com/token",
          },
          redirectUri: "https://example.com/callback",
          localCallbackUri: "http://localhost:12345/callback",
          auth: { kind: "pkce" },
        });
        const authorization = yield* client.authorize(["read"]).pipe(
          Effect.provideService(SecureRandom.SecureRandom, {
            ...random,
            randomBytes: (length) =>
              Effect.succeed(new Uint8Array(length).fill(7)),
          }),
        );
        const url = new URL(authorization.url);
        expect(authorization.verifier).toBe("BwcH".repeat(32));
        expect(authorization.state).toHaveLength(43);
        expect(url.searchParams.get("state")).toBe(authorization.state);
        expect(url.searchParams.get("scope")).toBe("read");
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        // Independently computed SHA-256 of the deterministic verifier above.
        expect(url.searchParams.get("code_challenge")).toBe(
          "ACJEUpYJg-d2X7Y9gQ8_l_humuBtq83VdRChja2AhDw",
        );
      }).pipe(Effect.provide(NodeCrypto.layer)),
    );
  }
});
