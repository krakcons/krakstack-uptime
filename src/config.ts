import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import defaultConfig from "../status.config.json" with { type: "json" };
import internalConfig from "../status.internal.json" with { type: "json" };
import { StatusConfigSchema } from "./schema.ts";

export const DEFAULT_CONFIG_PATH = "status.config.json";
export const INTERNAL_CONFIG_PATH = "status.internal.json";

export const StatusConfigPathSchema = Schema.Literals([
  DEFAULT_CONFIG_PATH,
  INTERNAL_CONFIG_PATH,
]).annotate({ identifier: "StatusConfigPath" });

export type StatusConfigPath = typeof StatusConfigPathSchema.Type;

const decodeConfig = Schema.decodeUnknownSync(StatusConfigSchema);

export const configs = {
  [DEFAULT_CONFIG_PATH]: decodeConfig(defaultConfig),
  [INTERNAL_CONFIG_PATH]: decodeConfig(internalConfig),
} satisfies Record<StatusConfigPath, typeof StatusConfigSchema.Type>;

export const configForPath = (path: StatusConfigPath) => configs[path];

export const ConfigPath = Config.string("STATUS_CONFIG_PATH").pipe(
  Config.withDefault(DEFAULT_CONFIG_PATH),
  Effect.flatMap((value) =>
    Schema.decodeUnknownEffect(StatusConfigPathSchema)(value).pipe(
      Effect.orDie,
    ),
  ),
);
