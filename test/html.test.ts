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

  it("reports a major issue when every active check fails", () => {
    expect(
      overallState(snapshot({ monitors: [monitor({ last_ok: 0 })] })).tone,
    ).toBe("major");
  });

  it("reports a partial issue when only some active checks fail", () => {
    expect(
      overallState(
        snapshot({
          monitors: [
            monitor({ id: "api", last_ok: 0 }),
            monitor({ id: "site", last_ok: 1 }),
          ],
        }),
      ).tone,
    ).toBe("partial");
  });

  it("reports an unknown state while an active check is pending", () => {
    expect(
      overallState(snapshot({ monitors: [monitor({ last_ok: null })] })).tone,
    ).toBe("unknown");
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

it("renders immediate custom uptime tooltips", () => {
  const now = Date.UTC(2026, 7, 25, 20, 0);
  const minute = Math.floor(now / 60_000);
  const statusMarkup = renderStatus(
    snapshot({
      monitors: [monitor()],
      minutes: [{ monitor_id: "api", bucket: minute, successful: 1, total: 1 }],
    }),
    now,
    "America/Toronto",
  );
  const page = renderPage("Krakstack Uptime", statusMarkup);

  expect(statusMarkup).toContain(
    'data-tooltip="Aug 25, 2026, 04:00 PM EDT: 100.00% uptime"',
  );
  expect(statusMarkup).not.toContain(" title=");
  expect(page).toContain("data-uptime-tooltip hidden");
  expect(page).toContain('document.addEventListener("pointermove"');
  expect(page).toContain('closest(".uptime-bars")');
  expect(page).toContain("offset / bounds.width * targets.length");
  expect(page).toContain('window.addEventListener("scroll", hideUptimeTooltip');
});

it("includes failed check duration in uptime tooltips", () => {
  const now = Date.UTC(2026, 7, 25, 20, 0);
  const hour = Math.floor(now / 3_600_000);
  const markup = renderStatus(
    snapshot({
      monitors: [monitor()],
      hours: [{ monitor_id: "api", bucket: hour, successful: 0, total: 65 }],
    }),
    now,
  );

  expect(markup).toContain("0.00% uptime · Failed checks: 1 hour 5 minutes");
});

it("renders accessible controls for all uptime ranges", () => {
  const markup = renderPage("Krakstack Uptime", renderStatus(snapshot()));

  expect(markup).toContain('data-range-button="minutes"');
  expect(markup).toContain('data-range-button="hours"');
  expect(markup).toContain('data-range-button="days"');
  expect(markup).toContain('aria-label="Uptime range"');
  expect(markup).toContain('localStorage.getItem("uptime-range")');
  expect(markup).not.toContain("Next check");
  expect(markup).not.toContain("data-next-check");
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
  expect(markup).toContain("1/2 operational");
  expect(markup).toContain("75.00% uptime");
  expect(markup).toContain("90-day aggregate");
  expect(markup.match(/<section class="service-group"/g)).toHaveLength(1);
});
