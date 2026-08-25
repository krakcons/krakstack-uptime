import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  DEFAULT_CONFIG_PATH,
  INTERNAL_CONFIG_PATH,
  StatusConfigPathSchema,
  configForPath,
} from "../src/config.ts";

describe("status configuration selection", () => {
  it("loads the generic default configuration", () => {
    const config = configForPath(DEFAULT_CONFIG_PATH);

    expect(config.domain).toBeUndefined();
    expect(config.monitors.map((monitor) => monitor.id)).toEqual(["website"]);
  });

  it("loads the internal configuration", () => {
    const config = configForPath(INTERNAL_CONFIG_PATH);

    expect(config.domain).toBe("status.krakconsultants.net");
    expect(config.timeZone).toBe("America/Toronto");
    expect(config.monitors.length).toBeGreaterThan(1);
  });

  it("rejects unsupported config paths", () => {
    expect(() =>
      Schema.decodeUnknownSync(StatusConfigPathSchema)("other.json"),
    ).toThrow();
  });
});
