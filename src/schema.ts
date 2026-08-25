import * as Schema from "effect/Schema";
import { isTimeZone } from "./time.ts";

export const EmailAddressSchema = Schema.String.check(
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: "Must be a valid email address",
  }),
).annotate({ identifier: "EmailAddress" });

export const AlertConfigSchema = Schema.Struct({
  from: EmailAddressSchema,
  emails: Schema.Array(EmailAddressSchema).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
}).annotate({ identifier: "AlertConfig" });

export const TimeZoneSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isTimeZone(value) ? undefined : "Must be a valid IANA time zone",
  ),
).annotate({ identifier: "TimeZone" });

export const MonitorMethodSchema = Schema.Literals(["GET", "HEAD"]).annotate({
  identifier: "MonitorMethod",
});

export const MonitorConfigSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  group: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  url: Schema.URLFromString,
  method: MonitorMethodSchema,
  expectedStatus: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 100, maximum: 599 }),
  ),
  timeoutMs: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1_000, maximum: 30_000 }),
  ),
}).annotate({ identifier: "MonitorConfig" });

export const StatusConfigSchema = Schema.Struct({
  siteName: Schema.NonEmptyString,
  domain: Schema.optional(Schema.NonEmptyString),
  timeZone: Schema.optional(TimeZoneSchema),
  alerts: Schema.optional(AlertConfigSchema),
  monitors: Schema.Array(MonitorConfigSchema),
}).annotate({ identifier: "StatusConfig" });

export const LatestCheckRowSchema = Schema.Struct({
  monitor_id: Schema.String,
  ok: Schema.Literals([0, 1]),
  checked_at: Schema.Int,
  latency_ms: Schema.Int,
}).annotate({ identifier: "LatestCheckRow" });

export const BucketRowSchema = Schema.Struct({
  monitor_id: Schema.String,
  bucket: Schema.Int,
  successful: Schema.Int,
  total: Schema.Int,
}).annotate({ identifier: "BucketRow" });

export const AlertStateRowSchema = Schema.Struct({
  ok: Schema.Literals([0, 1]),
}).annotate({ identifier: "AlertStateRow" });

export const PendingAlertRowSchema = Schema.Struct({
  id: Schema.Int,
  monitor_id: Schema.String,
  ok: Schema.Literals([0, 1]),
  created_at: Schema.Int,
}).annotate({ identifier: "PendingAlertRow" });

export const MonitorRowSchema = Schema.Struct({
  id: Schema.String,
  group: Schema.String,
  name: Schema.String,
  url: Schema.String,
  method: MonitorMethodSchema,
  expected_status: Schema.Int,
  timeout_ms: Schema.Int,
  active: Schema.Literal(1),
  last_ok: Schema.NullOr(Schema.Literals([0, 1])),
  last_checked_at: Schema.NullOr(Schema.Int),
  last_latency_ms: Schema.NullOr(Schema.Int),
}).annotate({ identifier: "MonitorRow" });

export const SnapshotSchema = Schema.Struct({
  monitors: Schema.Array(MonitorRowSchema),
  minutes: Schema.Array(BucketRowSchema),
  hours: Schema.Array(BucketRowSchema),
  days: Schema.Array(BucketRowSchema),
}).annotate({ identifier: "Snapshot" });

export class MonitorCheckError extends Schema.TaggedError<MonitorCheckError>()(
  "MonitorCheckError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type BucketRow = typeof BucketRowSchema.Type;
export type AlertConfig = typeof AlertConfigSchema.Type;
export type PendingAlertRow = typeof PendingAlertRowSchema.Type;
export type MonitorConfig = typeof MonitorConfigSchema.Type;
export type MonitorRow = typeof MonitorRowSchema.Type;
export type Snapshot = typeof SnapshotSchema.Type;
export type StatusConfig = typeof StatusConfigSchema.Type;
