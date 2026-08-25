import { describe, expect, it } from "@effect/vitest";
import { formatTimestamp, isTimeZone } from "../src/time.ts";

describe("time zones", () => {
  it("validates IANA time zones with Intl", () => {
    expect(isTimeZone("America/Toronto")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });

  it("formats timestamps in the selected time zone", () => {
    expect(
      formatTimestamp(Date.UTC(2026, 7, 25, 20, 0), "America/Toronto"),
    ).toBe("Aug 25, 2026, 04:00 PM EDT");
  });
});
