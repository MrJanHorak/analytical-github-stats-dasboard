# Working on this repo

Next.js 15 App Router + Drizzle/Postgres dashboard for GitHub repo traffic. Architecture and roadmap: `PLAN.md`. User-facing docs: `README.md`.

## Before finishing any change

Run all four (CI runs the same):

```bash
npm test && npm run lint && npm run typecheck && npm run build
```

## Keep the docs current — same change as the code

- **New env var** → add it to `.env.example` (with a comment) and the Configuration table in `README.md`.
- **New npm script** → Scripts table in `README.md`.
- **New API route** → HTTP routes table in `README.md`.
- **New/changed feature** → Features table and the relevant README section; roadmap in `PLAN.md`.
- **Schema change** → edit `src/lib/db/schema.ts`, run `npm run db:generate -- --name <what>` (needs any `DATABASE_URL` value), commit the migration, and update the data model in `PLAN.md`.
- **Visible UI change** → regenerate screenshots from demo data (never real stats):
  `npm run seed:demo`, `npm run build && npm start`, then `npm run screenshots` (`BASE_URL`, `CHROME_CHANNEL=chrome` if needed). Every image in `docs/` must be referenced from the README.

`tests/docs.test.ts` enforces the env var / script / route / image rules and fails CI on drift.

## Conventions

- Pure data shaping goes in `src/lib/transform.ts` with unit tests in `tests/transform.test.ts`.
- DB access goes through `getDb()`; integration tests inject PGlite with `setDbForTesting()` and apply the real `drizzle/` migrations.
- Anything that calls GitHub lives in `src/lib/github.ts` (no Next.js imports, so the CLI sync works); Next-specific caching lives in `src/lib/github-cached.ts`.
- All sync writes are upserts — re-running a sync must be safe.
- GitHub traffic dates are UTC days (`isoDay()`); today is partial, alerts judge yesterday.
- Local Postgres without Docker: `npx pglite-server --port=5499` and `DATABASE_URL=postgres://postgres@127.0.0.1:5499/postgres DB_POOL_MAX=1` (the PGlite server can't handle concurrent connections).
