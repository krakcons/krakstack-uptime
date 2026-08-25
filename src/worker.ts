import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { EmailMessageBuilder, SendEmail } from "@cloudflare/workers-types";
import * as Cloudflare from "alchemy/Cloudflare";
import * as SQL from "alchemy/SQL/D1";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import statusConfig from "../status.config.json" with { type: "json" };
import { makeAlertEmail, statusPageUrl } from "./alerts.ts";
import { Database } from "./database.ts";
import { renderPage, renderStatus } from "./html.ts";
import { StatusConfigSchema } from "./schema.ts";
import { HttpClientLive, makeStatus } from "./status.ts";

const config = Schema.decodeUnknownSync(StatusConfigSchema)(statusConfig);

const html = (body: string) =>
  HttpServerResponse.html(body).pipe(
    HttpServerResponse.setHeader("cache-control", "no-store"),
  );

const text = (message: string, status: number) =>
  HttpServerResponse.text(message, {
    status,
    headers: { "cache-control": "no-store" },
  });

const internalServerError = (cause: Cause.Cause<unknown>) =>
  Effect.logError(cause).pipe(Effect.as(text("Internal server error", 500)));

const alertEmailBinding: Cloudflare.Email.SendEmail | undefined = config.alerts
  ? {
      kind: "Cloudflare.Email.SendEmail",
      name: "StatusAlertEmail",
      allowedDestinationAddresses: [...config.alerts.emails],
      allowedSenderAddresses: [config.alerts.from],
    }
  : undefined;
const baseWorkerProps = config.domain
  ? { main: import.meta.url, domain: config.domain }
  : { main: import.meta.url };
const workerProps = alertEmailBinding
  ? {
      ...baseWorkerProps,
      bindings: { StatusAlertEmail: alertEmailBinding },
    }
  : baseWorkerProps;

export default class StatusWorker extends Cloudflare.Worker<StatusWorker>()(
  "StatusWorker",
  workerProps,
  Effect.gen(function* () {
    const d1 = yield* Cloudflare.D1.QueryDatabase(Database);
    const status = yield* makeStatus({ config }).pipe(
      Effect.provide(SQL.D1Layer(d1)),
      Effect.provide(HttpClientLive),
    );
    const alertConfig = config.alerts;
    const workerEnvironment = yield* Cloudflare.WorkerEnvironment;
    const email: SendEmail | undefined = alertConfig
      ? workerEnvironment.StatusAlertEmail
      : undefined;
    const sendEmail = email
      ? Effect.fn("Status.sendEmail")((message: EmailMessageBuilder) =>
          Effect.tryPromise({
            try: () => email.send(message),
            catch: (error) =>
              new Cloudflare.Email.SendEmailError({
                message: String(error),
                cause: error,
              }),
          }),
        )
      : undefined;
    const router = yield* HttpRouter.make;

    const checkAllAndAlert = status.checkAll().pipe(
      Effect.flatMap((alerts) =>
        sendEmail && alertConfig
          ? Effect.forEach(
              alerts,
              (alert) => {
                const message = makeAlertEmail({
                  alert,
                  siteName: config.siteName,
                  statusUrl: statusPageUrl(config),
                });
                return sendEmail({
                  from: alertConfig.from,
                  to: [...alertConfig.emails],
                  ...message,
                }).pipe(
                  Effect.tap(() => status.markAlertSent({ id: alert.id })),
                  Effect.tapError(Effect.logError),
                  Effect.ignore,
                );
              },
              { concurrency: 1, discard: true },
            )
          : Effect.void,
      ),
    );

    const loadFreshSnapshot = status
      .loadSnapshot()
      .pipe(
        Effect.flatMap((snapshot) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) =>
              snapshot.monitors.some(
                (monitor) =>
                  monitor.last_checked_at === null ||
                  monitor.last_checked_at < now - 90_000,
              )
                ? checkAllAndAlert.pipe(Effect.andThen(status.loadSnapshot()))
                : Effect.succeed(snapshot),
            ),
          ),
        ),
      );

    yield* router.add(
      "GET",
      "/",
      loadFreshSnapshot.pipe(
        Effect.map((snapshot) =>
          html(renderPage(config.siteName, renderStatus(snapshot))),
        ),
        Effect.catchCause(internalServerError),
      ),
    );

    yield* router.add(
      "GET",
      "/stream",
      loadFreshSnapshot.pipe(
        Effect.map((snapshot) =>
          HttpServerResponse.fromWeb(
            ServerSentEventGenerator.stream((stream) => {
              stream.patchElements(renderStatus(snapshot), {
                retryDuration: 15_000,
              });
            }),
          ),
        ),
        Effect.catchCause(internalServerError),
      ),
    );

    yield* router.add(
      "GET",
      "/health",
      HttpServerResponse.json({ status: "ok" }).pipe(
        Effect.catchCause(internalServerError),
      ),
    );
    yield* router.add("*", "/*", text("Not found", 404));

    yield* Cloudflare.Workers.cron("* * * * *", () =>
      checkAllAndAlert.pipe(Effect.tapCause(Effect.logError), Effect.ignore),
    );

    return {
      fetch: router.asHttpEffect().pipe(Effect.catchCause(internalServerError)),
    };
  }).pipe(
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
  ),
) {}
