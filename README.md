# Krakstack Uptime

A small, configuration-driven uptime page for Cloudflare. It uses:

- [Alchemy](https://alchemy.run/cloudflare/) for the Worker, D1 database, migrations, bindings, and cron trigger.
- [Effect](https://effect.website/) for configuration validation, D1 queries, concurrent checks, and failure handling.
- [Datastar](https://data-star.dev/) for live status updates over SSE.
- Cloudflare Workers and D1 only. No admin application, separate frontend build, server, or external database is required.

## Features

- GitHub Status-inspired public page with a 90-day uptime view.
- HTTP `GET` and `HEAD` monitors checked every minute.
- Configurable expected status and timeout per monitor.
- Schema-validated, version-controlled JSON configuration.
- Live public updates every 15 seconds through Datastar SSE reconnection.
- Automatic D1 migrations and check-history retention.
- Responsive desktop and mobile layout.

## Configure

Edit `status.config.json`:

```json
{
  "siteName": "Krakstack Uptime",
  "timeZone": "America/Toronto",
  "monitors": [
    {
      "id": "website",
      "group": "Apps",
      "name": "Website",
      "url": "https://example.com",
      "method": "GET",
      "expectedStatus": 200,
      "timeoutMs": 10000
    }
  ]
}
```

Each monitor requires:

| Field            | Description                                                                             |
| ---------------- | --------------------------------------------------------------------------------------- |
| `id`             | Stable unique identifier used for D1 history. Keep it unchanged when editing a monitor. |
| `group`          | Section used to group monitors and calculate aggregate uptime.                          |
| `name`           | Public display name.                                                                    |
| `url`            | HTTP or HTTPS endpoint to check.                                                        |
| `method`         | `GET` or `HEAD`.                                                                        |
| `expectedStatus` | Exact HTTP response status considered operational, from 100 to 599.                     |
| `timeoutMs`      | Request timeout from 1,000 to 30,000 milliseconds.                                      |

`src/schema.ts` contains the Effect schemas. Invalid configuration prevents the Worker from starting instead of silently deploying incorrect checks.

`timeZone` is optional and accepts an IANA time zone supported by `Intl`, such as `America/Toronto` or `Europe/Paris`. It controls timestamps in chart tooltips and alert emails; UTC is used by default.

### Alternate Configurations

`status.config.json` is the default configuration. Select another bundled configuration with `STATUS_CONFIG_PATH`:

```sh
STATUS_CONFIG_PATH=status.internal.json bun run dev
```

The included internal shortcut runs the same command:

```sh
bun run dev:internal
```

Use `bun run deploy:internal` when intentionally deploying `status.internal.json`. Both supported config files are validated at startup, and unsupported paths fail before deployment.

### Email Alerts

To email once when a monitor enters an outage and again when it recovers, add an alert sender and recipient list:

```json
{
  "alerts": {
    "from": "status@example.com",
    "emails": ["ops@example.com"]
  }
}
```

The sender domain must be configured for Cloudflare Email, and every recipient must be verified in the Cloudflare account. Cloudflare limits a message to 50 recipients. Failed deliveries remain in a D1 outbox and are retried by later checks; successful transition alerts are not sent again.

Each scheduled check makes up to three request attempts. A monitor enters an outage after failed checks in two consecutive minute buckets and recovers after its next successful check. Individual failed checks still count against uptime even when they do not become a confirmed outage.

## Local Development

Prerequisites:

- A [Cloudflare account](https://dash.cloudflare.com/sign-up). The free plan is sufficient for a small installation.
- [Bun](https://bun.sh/) 1.3 or newer.

Install dependencies and complete Alchemy's one-time Cloudflare login:

```sh
bun install
bun alchemy login --configure
```

Choose Cloudflare OAuth when prompted, then start the local Worker and D1 database:

```sh
bun run dev
```

Alchemy prints the local URL, normally `http://localhost:1337`. It runs the Worker in local `workerd`, creates local D1 storage, and applies migrations automatically.

Trigger the scheduled checks immediately:

```sh
curl "http://localhost:1337/cdn-cgi/handler/scheduled"
```

## Deploy

Deploy the configured status page:

```sh
bun run deploy
```

Alchemy deploys the production Worker and D1 resources in the `prod` stage, applies `migrations/`, and registers the one-minute cron. Deployment state is kept under `.alchemy/`; retain it for later updates and destruction. Local `bun run dev` resources use a separate development stage and do not replace production uptime history.

Edit `status.config.json` and deploy again whenever monitors change. Reusing a monitor's `id` preserves its existing uptime history.

## Checks

```sh
bun run fmt:check
bun run lint
bun run typecheck
bun test
```

Format files with:

```sh
bun run fmt
```

## Custom Domain

The default deployment uses a `workers.dev` URL. To use a domain already managed by your Cloudflare account, add `domain` to `status.config.json`:

```json
{
  "siteName": "Krakstack Uptime",
  "domain": "status.example.com",
  "monitors": []
}
```

Run `bun run deploy` again. Alchemy configures the Worker custom domain and certificate.

## Data Retention

D1 stores timestamped availability, response status, latency, and failure details. Checks older than 91 days are removed by the scheduled job. The public uptime bars aggregate the latest 90 days in UTC.

Remove all Cloudflare resources with:

```sh
bun run destroy
```

Destroying the stack deletes its D1 database and uptime history.
