import { describe, expect, it } from "@effect/vitest";
import { overallState, renderPage, renderStatus } from "../src/html.ts";
import type { MonitorRow, Snapshot } from "../src/schema.ts";

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  monitors: [],
  minutes: [],
  hours: [],
  days: [],
  ...overrides,
});

const monitor = (overrides: Partial<MonitorRow> = {}): MonitorRow => ({
  id: "api",
  group: "Apps",
  name: "API",
  url: "https://example.com",
  method: "GET",
  expected_status: 200,
  timeout_ms: 10_000,
  active: 1,
  last_ok: 1,
  last_checked_at: Date.now(),
  last_latency_ms: 120,
  ...overrides,
});

describe("overallState", () => {
  it("reports operational when there are no failures", () => {
    expect(overallState(snapshot())).toEqual({
      label: "All Systems Operational",
      tone: "operational",
    });
  });

  it("reports issues when an automatic check fails", () => {
    expect(
      overallState(snapshot({ monitors: [monitor({ last_ok: 0 })] })).tone,
    ).toBe("partial");
  });
});

it("escapes configured monitor content in status markup", () => {
  const markup = renderStatus(
    snapshot({
      monitors: [monitor({ name: "<script>alert(1)</script>" })],
    }),
  );

  expect(markup).not.toContain("<script>alert(1)</script>");
  expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});

it("renders monitor domains as safe external links", () => {
  const markup = renderStatus(
    snapshot({
      monitors: [monitor({ url: "https://example.com/path?a=1&b=2" })],
    }),
  );

  expect(markup).toContain(
    'href="https://example.com/path?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"',
  );
});

it("renders uptime totals independently for each time range", () => {
  const now = Date.UTC(2026, 7, 25);
  const minute = Math.floor(now / 60_000);
  const hour = Math.floor(now / 3_600_000);
  const day = Math.floor(now / 86_400_000);
  const markup = renderStatus(
    snapshot({
      monitors: [monitor()],
      minutes: [{ monitor_id: "api", bucket: minute, successful: 1, total: 2 }],
      hours: [{ monitor_id: "api", bucket: hour, successful: 3, total: 4 }],
      days: [{ monitor_id: "api", bucket: day, successful: 9, total: 10 }],
    }),
    now,
  );

  expect(markup).toContain("50.00% uptime");
  expect(markup).toContain("75.00% uptime");
  expect(markup).toContain("90.00% uptime");
  expect(markup).toContain('class="uptime-bar bad"');
});

it("renders accessible controls for all uptime ranges", () => {
  const markup = renderPage("Krakstack Uptime", renderStatus(snapshot()));

  expect(markup).toContain('data-range-button="minutes"');
  expect(markup).toContain('data-range-button="hours"');
  expect(markup).toContain('data-range-button="days"');
  expect(markup).toContain('aria-label="Uptime range"');
  expect(markup).toContain('localStorage.getItem("uptime-range")');
  expect(markup).toContain("Next check pending");
  expect(markup).toContain('data-last-check="0"');
  expect(markup).toContain("lastCheck + 60000 - Date.now()");
  expect(markup).toContain("setInterval(updateNextCheck, 1000)");
  expect(markup).toContain("new MutationObserver(applyUptimeRange)");
  expect(markup).not.toContain("new MutationObserver(refreshControls)");
});

it("groups monitors and calculates a weighted group aggregate", () => {
  const now = Date.UTC(2026, 7, 25);
  const day = Math.floor(now / 86_400_000);
  const markup = renderStatus(
    snapshot({
      monitors: [
        monitor({ id: "api", name: "API" }),
        monitor({ id: "site", name: "Site", last_ok: 0 }),
      ],
      days: [
        { monitor_id: "api", bucket: day, successful: 3, total: 3 },
        { monitor_id: "site", bucket: day, successful: 0, total: 1 },
      ],
    }),
    now,
  );

  expect(markup).toContain(">Apps</h3>");
  expect(markup).toContain("1 of 2 operational");
  expect(markup).toContain("75.00% uptime");
  expect(markup.match(/<section class="service-group"/g)).toHaveLength(1);
});
