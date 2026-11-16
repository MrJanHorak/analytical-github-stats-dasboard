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
| Languages | `GET /repos/{o}/{r}/languages` | current | bytes per language; stored when the repo is pushed |
| Default-branch commit | `GET /repos/{o}/{r}/branches/{branch}` | current | decides whether lines need recounting |
| Repo tarball | `GET /repos/{o}/{r}/tarball/{sha}` | per commit | streamed and counted for lines of code, and its manifests/config files read for frameworks (Contents: read) |
| Lines added/deleted | `GET /repos/{o}/{r}/stats/code_frequency` | weekly, all history | shown monthly as the code-growth chart on repo detail (live, cached 6h); 202 while computing, 422 for 10k+ commits |
| Your contributions | GraphQL `viewer.contributionsCollection(from, to)` | one calendar year per query | commits, PRs, issues, reviews, daily calendar, commits/PRs per repo |
| You | `GET /user` | current | followers / following → daily snapshot |
| Issues & PRs | `GET /repos/{o}/{r}/issues?state=all&since=…` | incremental | issues list includes PRs (`pull_request.merged_at`); repos with issues off fall back to `GET /pulls`; private repos need **Issues** + **Pull requests: Read-only** (403 → `issues_available = false`, panel explains) |
| Actions runs | `GET /repos/{o}/{r}/actions/runs?created=>=…` | incremental | needs **Actions: Read-only**; 403 → panel explains |
| Community profile | `GET /repos/{o}/{r}/community/profile` | current | public repos only; rechecked on push or weekly |
| Dependabot alerts | `GET /repos/{o}/{r}/dependabot/alerts?state=open` | current | needs **Dependabot alerts: Read-only**; 403/404 → null |
| Commit activity | `GET /repos/{o}/{r}/stats/commit_activity` | weekly, 52 weeks | may return 202 while GitHub computes |
| Stargazers with timestamps | `GET /repos/{o}/{r}/stargazers` (star+json) | full history | optional backfill for star history before the app existed |
| Forks list | `GET /repos/{o}/{r}/forks` | full list | who forked, when |

Not available from GitHub: visitor geography, devices, user agents (so no way to tell people from bots), time-of-day, individual identities of viewers, or traffic older than 14 days.

## 3. Stack

- **Next.js 15 (App Router) + TypeScript** — server components query the DB directly.
- **Tailwind CSS v4** for styling, **Recharts** for charts.
- **Postgres** via **Drizzle ORM**: Neon's serverless HTTP driver for `*.neon.tech`, postgres.js (TCP) for anything else.
- **Octokit** for the GitHub REST API.
- **Vercel Cron** hitting `/api/cron/sync` daily (a GitHub Actions schedule is an equally good alternative).
- **Vitest + PGlite** (in-memory Postgres with the real migrations) for tests; **Playwright** for README screenshots; ESLint; GitHub Actions CI.

## 4. Auth (v1: single user)

- A **fine-grained personal access token** in `GITHUB_TOKEN`, scoped to *All repositories* with **Administration: Read-only** (required for traffic), **Contents: Read-only** (release download counts and line counting), **Issues** + **Pull requests: Read-only** (issue/PR stats for private repos) and **Metadata: Read-only**. Optional: **Actions: Read-only** (CI stats) and **Dependabot alerts: Read-only** (security alerts). A classic token with `repo` scope also works.
- Dashboard, CSV export and note-editing server actions are protected by `DASHBOARD_PASSWORD` (HTTP basic auth middleware). Exceptions: `/api/cron/*` (own bearer secret) and `/api/badge/*` (public by design, public repos only).
- **v2 (M4b):** a GitHub App + Auth.js sign-in so multiple users can track their own repos (tables already carry `owner`) — see the roadmap.

## 5. Data model

```
repos            (id PK = GitHub repo id, owner, name, full_name, description,
                  private, fork, archived, language, html_url, created_at, pushed_at, synced_at,
                  lines_of_code, code_stats_pushed_at, loc_commit_sha)
                  [non-blank LOC on the default branch; pushed_at last checked; commit counted]
repo_languages   (repo_id, language) PK — bytes   [current; replaced when the repo is pushed]
repo_loc         (repo_id, language) PK — files, lines, non_blank   [current; replaced on recount]
repo_frameworks  (repo_id, framework) PK — category, version   [detected from manifests; replaced on recount]
repo_snapshots   (repo_id, date) PK — stars, forks, watchers, open_issues, size_kb
traffic_daily    (repo_id, date) PK — views, view_uniques, clones, clone_uniques
traffic_windows  (repo_id, date) PK — GitHub's deduplicated 14-day totals as of date
referrers        (repo_id, date, referrer) PK — count, uniques   [14-day window as of date]
popular_paths    (repo_id, date, path) PK — title, count, uniques
release_assets   (repo_id, date, asset_id) PK — release_tag, asset_name, downloads (cumulative)
star_events      (repo_id, login) PK — starred_at        [full star history, refetched only when count changes]
fork_events      (repo_id, fork_id) PK — full_name, owner, stars, created_at
alerts           (id, repo_id, date, kind) — message, value, baseline, notified_at   [unique (repo_id, date, kind)]
annotations      (id, repo_id, date, label) — user notes shown as chart markers
sync_runs        (id, started_at, finished_at, repos_synced, error)

contribution_days  (login, date) PK — count            [daily calendar back to account creation]
contribution_years (login, year) PK — commits, pull_requests, issues, reviews, repos_with_commits,
                   restricted, total, synced_at        [a year is final once synced after it ended]
contribution_repos (login, year, repo) PK — commits, pull_requests   [any repo, owner/name]
profile_snapshots  (login, date) PK — followers, following, public_repos

issues           (repo_id, number) PK — is_pr, title, author, author_association, is_bot, state,
                 created_at, closed_at, merged_at
workflow_runs    (repo_id, run_id) PK — workflow, event, branch, status, conclusion,
                 created_at, started_at, updated_at
repo_health      (repo_id) PK — health_percentage, has_readme/license/code_of_conduct/contributing/
                 issue_template/pr_template/description, health_checked_at,
                 dependabot_critical/high/medium/low (null = unavailable), actions_available, issues_available,
                 issues_synced_at, runs_synced_at, activity_synced_at   [activity sync markers]
```

All writes are upserts, so re-running the sync is safe and the partial "today" row simply gets corrected next run.

## 6. Sync job (`/api/cron/sync` daily, or `npm run sync`)

1. Cron route is authenticated by `Authorization: Bearer $CRON_SECRET` (Vercel sends this automatically).
2. List all owned repos (paginated) → upsert `repos` + today's `repo_snapshots`.
3. **Traffic first** (concurrency 4, skipping archived repos): views, clones, 14-day totals, referrers, paths, releases → upsert. This always runs in full because GitHub deletes it after 14 days.
4. **History second**: refetch stargazers/forks only for repos whose count changed, smallest first, until `SYNC_TIME_BUDGET_MS` (cron default 45s; CLI unlimited). Leftovers resume next run.
5. **Code stats**: for repos pushed since they were last checked, refresh languages; then, if the default branch has a new commit, stream its tarball and count lines (`src/lib/loc.ts`: non-blank lines in code files; lock files, vendored/build dirs, minified, binary, >1 MB and `.gitattributes` linguist-generated/vendored/documentation files left out). Two at a time, same time budget as history; leftovers and failures resume next run. Repos over 500 MB are skipped. The same pass reads dependency manifests and config files for frameworks & tools (`src/lib/frameworks.ts`: ~100 rules in 10 categories; manifests in vendored dirs ignored; highest declared version wins).
6. **Your contributions** (right after traffic, `src/lib/sync-contributions.ts`): snapshot followers; fetch each calendar year that has never been stored or wasn't synced after it ended, newest first (first run = full backfill to account creation; afterwards just the current year). Same time budget.
7. **Repo activity** (`src/lib/sync-activity.ts`, your own non-fork, non-archived repos, least recently synced first, same time budget): issues & PRs updated since the last sync (10-minute overlap; everything on the first run), Actions runs created since the last sync minus a day (so in-progress runs get their conclusion; 90 days on the first run), open Dependabot alerts, and the community profile when the repo was pushed or the last check is a week old. Missing Issues/PRs, Actions or Dependabot permissions are recorded (`issues_available`, `actions_available`, null counts), not errors; the issues marker is kept so nothing is missed once access is granted.
8. **Alerts**: judge yesterday against stored history → insert into `alerts` (idempotent) → post unnotified ones to `ALERT_WEBHOOK_URL`.
9. Record a `sync_runs` row. About 5 requests per repo plus history refreshes, so 100 repos ≈ 500 requests, well under the 5,000/hour limit.

## 7. UI

**Overview `/`**: range picker (7/14/30/90/365/all), KPI cards with % vs previous period and GitHub's deduplicated 14-day uniques, daily traffic chart with note markers, top referrers with sparklines, recent alerts, languages across all repos and lines of code in total, by language and largest repos (forks excluded), sortable/filterable repo table with sparklines, a lines column and a 🤖 likely-automated clones hint, CSV export.

**Repo detail `/repo/[owner]/[name]`**: KPIs; views/clones charts with note and alert markers; stars & forks history from event timestamps; weekly commits (fetched live, cached); lines of code by language and GitHub's languages by bytes (stored by the sync); a likely-automated clones note; notes & alerts (add/delete notes); referrer trend; referrers and popular content; recent stargazers and forks; release downloads.

**Project activity** (overview: all your repos; repo detail: one repo): issues & PRs opened/closed/merged in the range, open now, median time to close issues / merge PRs, outside contributors (author association not OWNER/MEMBER/COLLABORATOR, bots excluded), weekly opened-vs-closed chart; Actions pass rate (success vs failure/timed out — cancelled and skipped left out), runs, median duration, per-workflow table, recent failures; open Dependabot alerts by severity. Repo detail adds the community-health checklist and open issues/PRs. Repo table: health % and CI pass-rate columns, Dependabot alerts badge.

**Frameworks & tools** (overview): one row per category with a chip per framework (repos using it, newest version) linking to `/?q=<name>#repos`, which filters the repo table (the filter matches repo names and frameworks). Repo detail shows them as tags in the Code section.

**Your activity `/me`**: all-time commits / PRs / issues / reviews, contributions in the last 12 months, repos contributed to, current & longest streak, followers (+30d); GitHub-style heatmap; per-year table; top repos (yours link to their detail page, others marked external); followers chart.

Repo detail also gets a **code growth** chart: lines added/deleted per month from `stats/code_frequency` (live, cached).

**Badges `/api/badge/[owner]/[name]`**: public SVG for public repos only.

## 8. Roadmap

- **M1 ✅** schema, sync job, overview + detail pages, cron.
- **M2 ✅** basic-auth middleware, range picker incl. all-time, sparklines, % vs previous period (only when a full previous window is stored), full star/fork history from GitHub timestamps, recent stargazers/forks, CSV export, demo seed data, any-Postgres support, unit + integration tests, CI.
- **M2.5 ✅** time-budgeted sync (traffic first, history backfills resume next run), GitHub's deduplicated 14-day uniques, 1h cache for live languages/commit stats, referrer trend chart + sparklines, ESLint in CI.
- **M3 ✅** alerts (views/clones spikes, star bursts, star milestones) stored per day, shown in the UI and posted to a Slack/Discord webhook; notes pinned to dates as chart markers; public SVG badges; screenshot script and a docs-drift test in CI.
- **M3.5 ✅** languages across all repos, likely-automated clone hint (heuristic: many clones, few views); real lines of code counted from default-branch tarballs (lock files, vendored, generated, minified and non-code files excluded, `.gitattributes` honoured, recount only on a new default-branch commit), per language and in total.
- **M3.6 ✅** `/me` page — contribution totals via GraphQL `contributionsCollection` (year-by-year backfill to account creation, then current year only): commits, PRs, issues, reviews, repos contributed to; contribution heatmap + streaks; daily followers snapshots. Code-growth chart (lines added/deleted per month, from code_frequency) on repo detail.
- **M3.7 ✅** community health checklist column (`/community/profile`); issue/PR flow (open vs closed, median time to close/merge, outside contributors); Actions CI pass rate + durations; optional Dependabot alert counts (extra permission). Incremental activity sync (~3 requests/repo/day).
- **M3.8 ✅** frameworks & tools detected from manifests and config files during the tarball pass (npm, PyPI, RubyGems, Composer, Go, Cargo, Maven/Gradle + config files), overview panel by category, table filter, repo tags. Migration forces one recount of every repo.
- **M4a:** release-date markers from GitHub releases; per-repo alert thresholds.
- **M4b:** multi-user via a **GitHub App** (not an OAuth App — its `repo` scope would grant write access to every private repo) + Auth.js "Sign in with GitHub". Users install the App on chosen repos (Administration, Contents, Metadata: read); the cron uses installation tokens so syncs run with nobody logged in; every query scoped by owner; sync fanned out across installations.
- **M4c:** email alerts.
