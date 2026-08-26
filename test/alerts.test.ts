import { describe, expect, it } from "@effect/vitest";
import {
  makeAlertEmail,
  shouldAlert,
  statusPageUrl,
  type StatusAlert,
} from "../src/alerts.ts";

const alert = (overrides: Partial<StatusAlert> = {}): StatusAlert => ({
  id: 1,
  monitor_id: "api",
  ok: 0,
  created_at: Date.UTC(2026, 7, 25, 20, 0),
  group: "Apps",
  name: "API",
  url: "https://api.example.com/health",
  ...overrides,
});

describe("shouldAlert", () => {
  it.each([
    [undefined, 0, true],
    [undefined, 1, false],
    [1, 0, true],
    [0, 1, true],
    [0, 0, false],
    [1, 1, false],
  ] as const)("maps %s -> %s to %s", (previous, current, expected) => {
    expect(shouldAlert(previous, current)).toBe(expected);
  });
});

it("formats an outage email", () => {
  expect(
    makeAlertEmail({
      alert: alert(),
      siteName: "Krakstack Uptime",
      statusUrl: "https://status.example.com",
      timeZone: "America/Toronto",
    }),
  ).toEqual({
    subject: "[Krakstack Uptime] OUTAGE: API",
    text: [
      "API is experiencing an outage.",
      "",
      "Group: Apps",
      "Service: https://api.example.com/health",
      "Checked: Aug 25, 2026, 04:00 PM EDT",
      "Status page: https://status.example.com",
    ].join("\n"),
  });
});

it("formats a recovery email", () => {
  const message = makeAlertEmail({
    alert: alert({ ok: 1 }),
    siteName: "Krakstack Uptime",
  });

  expect(message.subject).toBe("[Krakstack Uptime] RECOVERED: API");
  expect(message.text).toContain("API is operational again.");
});

it("derives the status URL from the configured domain", () => {
  expect(
    statusPageUrl({
      siteName: {
        label: "KrakStack",
        en: "Uptime",
        fr: "Disponibilité",
      },
      domain: "status.example.com",
      monitors: [],
    }),
  ).toBe("https://status.example.com");
});
