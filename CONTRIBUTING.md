# Contributing

Thank you for contributing to Krakstack Uptime.

## Before You Start

- Search existing issues before opening a new one.
- Use an issue to discuss substantial features or architecture changes before implementation.
- Never include credentials, private endpoints, recipient addresses, or Alchemy state in a report or pull request.

## Local Setup

You need Bun 1.3 or newer and a Cloudflare account.

```sh
bun install
bun alchemy login --configure
bun run dev
```

Alchemy prints the local Worker URL, normally `http://localhost:1337`. Trigger a scheduled check locally with:

```sh
curl "http://localhost:1337/cdn-cgi/handler/scheduled"
```

See [README.md](README.md) for configuration and deployment details.

## Making Changes

- Keep changes focused and consistent with the existing Cloudflare Worker, D1, Effect, and Datastar architecture.
- Add or update tests for behavior changes.
- Add a new numbered migration instead of modifying a migration that may already have been applied.
- Keep monitor IDs stable when editing configuration because they identify persisted uptime history.
- Do not commit `.alchemy/`, `.env` files, generated output, or local databases.

## Checks

Run all checks before submitting a pull request:

```sh
bun run fmt:check
bun run lint
bun run typecheck
bun run test
```

Use `bun run fmt` to format changed files.

## Pull Requests

Describe the problem, the chosen solution, and how you verified it. Keep unrelated changes out of the pull request and note any configuration, migration, or deployment impact.
