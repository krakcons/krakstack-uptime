# AGENTS

## Core Rules

- If `PROJECT_AGENTS.md` exists in the repository root, read it immediately and treat it as additional mandatory project instructions.
- Prefer the smallest correct change that fits the existing architecture.
- Use project conventions already present in nearby files before introducing new patterns.
- Do not edit generated files or Alchemy state.

## Architecture

- This is a configuration-driven Cloudflare Worker. It does not have a separate frontend or admin application.
- `alchemy.run.ts` defines the Alchemy stack and composes the Worker and D1 resources.
- `src/worker.ts` handles HTTP requests, Datastar SSE updates, and scheduled monitor checks.
- `src/html.ts` renders the public status page as server-generated HTML.
- `src/status.ts` runs checks and builds status snapshots.
- `src/alerts.ts` manages outage transitions and Cloudflare Email alerts.
- `src/database.ts` defines the D1 database and migrations.
- `src/config.ts` loads a bundled status configuration selected by `STATUS_CONFIG_PATH`.
- `src/schema.ts` contains Effect schemas and domain types.
- `migrations/` contains append-only D1 migrations. Do not modify an applied migration; add a new numbered migration.
- `status.config.json` and `status.internal.json` are both imported and validated at build time. Keep both valid even when only one is deployed.

## Code Practices

- Use Effect for configuration, validation, concurrency, retries, and typed failures.
- Use Effect `Schema` for untrusted configuration and database values instead of ad hoc runtime validation.
- Annotate reusable schemas with an `identifier`.
- Keep Worker APIs and Cloudflare bindings compatible with the Workers runtime.
- Prefer arrow functions except where Effect generator APIs require `function*`.
- Avoid type assertions unless necessary and document why an assertion is safe.
- Keep public HTML accessible and responsive; escape dynamic content before rendering it.
- Do not add a frontend build system for changes that fit the existing server-rendered page.

## Deployment Safety

- Never commit `.alchemy/`; it contains local and production deployment state.
- Do not delete `.alchemy/` when production resources may need to be updated or destroyed.
- Reusing a monitor `id` preserves its D1 history. Treat monitor IDs as stable persisted identifiers.
- Scheduled checks run every minute. Consider retries, alert deduplication, and retention when changing their behavior.
- Avoid running `bun run deploy`, `bun run deploy:internal`, or `bun run destroy` unless explicitly requested.

## Testing

- Use Vitest with `@effect/vitest`.
- Add focused `*.test.ts` coverage in `test/` for behavior changes.
- Run the repository checks after code changes:
  - `bun run fmt:check`
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test`

<!-- intent-skills:start -->

## Skill Loading

Before substantial work:

- Skill check: run `npx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `npx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Multiple matches: prefer the most specific skill for the concern being changed.

<!-- intent-skills:end -->
