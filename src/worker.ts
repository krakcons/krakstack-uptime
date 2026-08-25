import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
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

const Email = config.alerts
  ? Cloudflare.Email.SendEmail("StatusAlertEmail", {
      allowedDestinationAddresses: [...config.alerts.emails],
      allowedSenderAddresses: [config.alerts.from],
    })
  : undefined;
const workerProps = config.domain
  ? { main: import.meta.url, domain: config.domain }
  : { main: import.meta.url };

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
    const email = Email ? yield* Cloudflare.Email.Send(Email) : undefined;
    const router = yield* HttpRouter.make;

    const checkAllAndAlert = status.checkAll().pipe(
      Effect.flatMap((alerts) =>
        email && alertConfig
          ? Effect.forEach(
              alerts,
              (alert) => {
                const message = makeAlertEmail({
                  alert,
                  siteName: config.siteName,
                  statusUrl: statusPageUrl(config),
                  timeZone: config.timeZone,
                });
                return email
                  .send({
                    from: alertConfig.from,
                    to: [...alertConfig.emails],
                    ...message,
                  })
                  .pipe(
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
                ? status.checkAll().pipe(Effect.andThen(status.loadSnapshot()))
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
          html(
            renderPage(
              config.siteName,
              renderStatus(snapshot, undefined, config.timeZone),
            ),
          ),
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
              stream.patchElements(
                renderStatus(snapshot, undefined, config.timeZone),
                {
                  retryDuration: 15_000,
                },
              );
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
    Effect.provide(Cloudflare.Email.SendBinding),
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
  ),
) {}
