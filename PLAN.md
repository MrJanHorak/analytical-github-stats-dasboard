# GitHub Repo Stats — Architecture Plan

A Next.js dashboard that collects every useful metric GitHub exposes for your repositories, **stores it permanently**, and shows it as an all-repos overview plus a per-repo detail view.

## 1. The key constraint: GitHub only keeps 14 days of traffic

The Traffic API (views, clones, referrers, popular paths) returns only the **last 14 days**, and referrers/paths are a rolling 14‑day aggregate with no per-day breakdown. There is no way to fetch older traffic later.

So the app is really two things:

1. **A collector** — a scheduled job (daily) that pulls the data and upserts it into a database, building history that grows forever.
2. **A dashboard** — reads only from the database (fast, no rate-limit pressure).

Run the collector at least every ~13 days; daily is recommended so you also get daily star/fork snapshots.

## 2. What data is available

| Data | Endpoint | Granularity | Notes |
|---|---|---|---|
| Views + unique visitors | `GET /repos/{o}/{r}/traffic/views?per=day` | daily, 14 days | needs push access |
| Clones + unique cloners | `GET /repos/{o}/{r}/traffic/clones?per=day` | daily, 14 days | needs push access |
| Top referrers (top 10) | `GET /repos/{o}/{r}/traffic/popular/referrers` | 14-day aggregate | snapshot per sync day |
| Top content/paths (top 10) | `GET /repos/{o}/{r}/traffic/popular/paths` | 14-day aggregate | snapshot per sync day |
| Stars, forks, watchers, open issues, size | `GET /user/repos` | current value | snapshot daily → growth charts |
| Release asset downloads | `GET /repos/{o}/{r}/releases` | cumulative | snapshot daily → downloads/day |
| Languages | `GET /repos/{o}/{r}/languages` | current | bytes per language |
| Commit activity | `GET /repos/{o}/{r}/stats/commit_activity` | weekly, 52 weeks | may return 202 while GitHub computes |
| Stargazers with timestamps | `GET /repos/{o}/{r}/stargazers` (star+json) | full history | optional backfill for star history before the app existed |
| Forks list | `GET /repos/{o}/{r}/forks` | full list | who forked, when |

Not available from GitHub: visitor geography, devices, time-of-day, individual identities of viewers, or traffic older than 14 days.

## 3. Stack

- **Next.js 15 (App Router) + TypeScript** — server components query the DB directly.
- **Tailwind CSS v4** for styling, **Recharts** for charts.
- **Postgres** (Neon free tier works well with Vercel) via **Drizzle ORM**.
- **Octokit** for the GitHub REST API.
- **Vercel Cron** hitting `/api/cron/sync` daily (a GitHub Actions schedule is an equally good alternative).

## 4. Auth (v1: single user)

- A **fine-grained personal access token** in `GITHUB_TOKEN`, scoped to *All repositories* with **Administration: Read-only** (required for traffic) and **Metadata: Read-only**. A classic token with `repo` scope also works.
- Dashboard itself is protected by a simple `DASHBOARD_PASSWORD` (middleware) — or deploy privately.
- **v2:** Auth.js GitHub OAuth / a GitHub App so multiple users can sign in and track their own repos (tables already carry `owner`).

## 5. Data model

```
repos            (id PK = GitHub repo id, owner, name, full_name, description,
                  private, fork, archived, language, html_url, created_at, pushed_at, synced_at)
repo_snapshots   (repo_id, date) PK — stars, forks, watchers, open_issues, size_kb
traffic_daily    (repo_id, date) PK — views, view_uniques, clones, clone_uniques
referrers        (repo_id, date, referrer) PK — count, uniques   [14-day window as of date]
popular_paths    (repo_id, date, path) PK — title, count, uniques
release_assets   (repo_id, date, asset_id) PK — release_tag, asset_name, downloads (cumulative)
star_events      (repo_id, login) PK — starred_at        [full star history, refetched only when count changes]
fork_events      (repo_id, fork_id) PK — full_name, owner, stars, created_at
sync_runs        (id, started_at, finished_at, repos_synced, error)
```

All writes are upserts, so re-running the sync is safe and the partial "today" row simply gets corrected next run.

## 6. Sync job (`/api/cron/sync`)

1. Authenticated by `Authorization: Bearer $CRON_SECRET` (Vercel sends this automatically).
2. List all owned repos (paginated) → upsert `repos` + today's `repo_snapshots`.
3. For each repo (concurrency 4): views, clones, referrers, paths, releases → upsert.
4. Record a `sync_runs` row. ~5 requests per repo, so 100 repos ≈ 500 requests — far under the 5,000/hour limit.
5. Vercel Hobby functions time out at 60s; for many repos, set `maxDuration` higher (Pro) or move the sync to a GitHub Actions workflow that runs `npm run sync`.

## 7. UI

**Overview `/`**
- Range picker: 7 / 14 / 30 / 90 / 365 days / all.
- KPI cards: total views, unique visitors, clones, unique cloners, total stars, total forks (with change over range).
- Stacked area chart: daily views across all repos.
- Sortable table: repo, views, uniques, clones, stars (+Δ), forks (+Δ), sparkline, last push.
- Top referrers across all repos.

**Repo detail `/repo/[owner]/[name]`**
- KPIs for that repo, views/clones line chart (total vs unique).
- Stars & forks over time (from snapshots).
- Referrers and popular paths tables (latest window) + referrer trend.
- Release downloads per asset.
- Languages breakdown, commit activity (fetched live, cached).

## 8. Roadmap

- **M1 ✅** schema, sync job, overview + detail pages, cron.
- **M2 ✅** basic-auth middleware, range picker incl. all-time, sparklines, % vs previous period (only when a full previous window is stored), full star/fork history from GitHub timestamps, recent stargazers/forks, CSV export, demo seed data, any-Postgres support, unit + integration tests, CI.
- **M3:** referrer trend charts (referrers are stored daily already), week-over-week alerts (traffic spike → email/webhook), per-repo notes/annotations on charts (e.g. "posted on HN"), README badge endpoint.
- **M4:** multi-user via GitHub OAuth / GitHub App.
