import { describe, expect, test } from "bun:test";
import { overallState, renderStatus } from "../src/html.ts";

const snapshot = (overrides = {}) => ({
  monitors: [],
  daily: [],
  ...overrides,
});

describe("overallState", () => {
  test("reports operational when there are no failures", () => {
    expect(overallState(snapshot())).toEqual({
      label: "All Systems Operational",
      tone: "operational",
    });
  });

  test("automatic check failures affect the headline", () => {
    const monitor = {
      id: "api",
      name: "API",
      url: "https://example.com",
      method: "GET",
      expected_status: 200,
      timeout_ms: 10_000,
      active: 1,
      last_ok: 0,
      last_checked_at: Date.now(),
      last_latency_ms: 120,
    };
    expect(overallState(snapshot({ monitors: [monitor] })).tone).toBe(
      "partial",
    );
  });
});

test("status markup escapes configured monitor content", () => {
  const monitor = {
    id: "website",
    name: "<script>alert(1)</script>",
    url: "https://example.com",
    method: "GET",
    expected_status: 200,
    timeout_ms: 10_000,
    active: 1,
    last_ok: 1,
    last_checked_at: Date.now(),
    last_latency_ms: 100,
  };
  const markup = renderStatus(snapshot({ monitors: [monitor] }));
  expect(markup).not.toContain("<script>alert(1)</script>");
  expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
});
