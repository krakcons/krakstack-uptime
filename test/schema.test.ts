import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { StatusConfigSchema } from "../src/schema.ts";

const decodeConfig = Schema.decodeUnknownSync(StatusConfigSchema);

const config = {
  siteName: "Krakstack Uptime",
  monitors: [
    {
      id: "cords-widget",
      group: "Apps",
      name: "Cords Widget",
      url: "https://widget.cords.ai?q=food&api_key=test",
      method: "GET",
      expectedStatus: 200,
      timeoutMs: 10_000,
    },
  ],
};

describe("StatusConfigSchema", () => {
  it("decodes a valid monitor URL with query parameters", () => {
    const decoded = decodeConfig(config);

    expect(decoded.monitors[0]?.url.toString()).toBe(
      "https://widget.cords.ai/?q=food&api_key=test",
    );
  });

  it("decodes an optional custom domain", () => {
    expect(
      decodeConfig({ ...config, domain: "status.example.com" }).domain,
    ).toBe("status.example.com");
  });

  it("decodes alert sender and recipient emails", () => {
    const decoded = decodeConfig({
      ...config,
      alerts: {
        from: "status@example.com",
        emails: ["ops@example.com", "owner@example.com"],
      },
    });

    expect(decoded.alerts?.emails).toEqual([
      "ops@example.com",
      "owner@example.com",
    ]);
  });

  it.each([
    ["an invalid sender", { from: "invalid", emails: ["ops@example.com"] }],
    [
      "an invalid recipient",
      { from: "status@example.com", emails: ["invalid"] },
    ],
    ["no recipients", { from: "status@example.com", emails: [] }],
  ])("rejects alert configuration with %s", (_name, alerts) => {
    expect(() => decodeConfig({ ...config, alerts })).toThrow();
  });

  it("rejects unsupported HTTP methods", () => {
    expect(() =>
      decodeConfig({
        ...config,
        monitors: [{ ...config.monitors[0], method: "POST" }],
      }),
    ).toThrow();
  });

  it.each([
    ["status below HTTP range", { expectedStatus: 99 }],
    ["status above HTTP range", { expectedStatus: 600 }],
    ["timeout below minimum", { timeoutMs: 999 }],
    ["timeout above maximum", { timeoutMs: 30_001 }],
  ])("rejects %s", (_name, override) => {
    expect(() =>
      decodeConfig({
        ...config,
        monitors: [{ ...config.monitors[0], ...override }],
      }),
    ).toThrow();
  });
});
