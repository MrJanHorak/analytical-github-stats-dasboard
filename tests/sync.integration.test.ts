/**
 * End-to-end check of the collector + dashboard queries against a real (in-memory) Postgres,
 * with the GitHub API mocked. Applies the actual drizzle/ migrations.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTesting } from "@/lib/db";
import * as gh from "@/lib/github";
import { getExportData, getMe, getOverview, getRepoDetail } from "@/lib/queries";
import { runSync } from "@/lib/sync";
import { syncContributions, yearsToFetch } from "@/lib/sync-contributions";
import { toCsv } from "@/lib/transform";
import { daysAgo, isoDay } from "@/lib/utils";

vi.mock("@/lib/github", () => ({
  listOwnedRepos: vi.fn(),
  fetchTraffic: vi.fn(),
  fetchReleases: vi.fn(),
  fetchStargazers: vi.fn(),
  fetchForks: vi.fn(),
  fetchLanguages: vi.fn(),
  fetchBranchSha: vi.fn(),
  fetchTarball: vi.fn(),
  fetchCommitActivity: vi.fn(),
  fetchViewer: vi.fn(),
  fetchContributions: vi.fn(),
}));
const m = vi.mocked(gh);

/** A gzipped GitHub-style tarball (one top-level directory) with the given files. */
async function tarball(files: Record<string, string>) {
  const p = pack();
  for (const [name, body] of Object.entries(files)) p.entry({ name: `jan-repo-abc/${name}` }, body);
  p.finalize();
  const chunks: Buffer[] = [];
  for await (const c of p) chunks.push(c as Buffer);
  return Readable.from([gzipSync(Buffer.concat(chunks))]);
}
/** A year of contributions: one commit-day on 1 Feb and 2 Feb, two repos. */
function contributions(year: number, commits = 2) {
  return {
    commits,
    pullRequests: 1,
    issues: 3,
    reviews: 4,
    reposWithCommits: 2,
    restricted: 0,
    total: commits + 8,
    days: [
      { date: `${year - 1}-12-31`, count: 99 }, // calendar weeks can spill into the previous year — ignored
      { date: `${year}-02-01`, count: 1 },
      { date: `${year}-02-02`, count: 1 },
    ],
    repos: [
      { repo: "jan/alpha", commits, pullRequests: 0 },
      { repo: "someone/lib", commits: 0, pullRequests: 1 },
    ],
  };
}
const lines = (n: number) => "x();\n\n".repeat(n); // n non-blank lines (+ n blank ones)

const ts = (daysBack: number) => `${daysAgo(daysBack)}T00:00:00Z`;

function repo(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    full_name: `jan/${name}`,
    owner: { login: "jan" },
    description: `${name} description`,
    private: false,
    fork: false,
    archived: false,
    language: "TypeScript",
    html_url: `https://github.com/jan/${name}`,
    created_at: "2024-01-01T00:00:00Z",
    pushed_at: ts(1),
    stargazers_count: 2,
    forks_count: 1,
    watchers_count: 2,
    open_issues_count: 0,
    size: 100,
    default_branch: "main",
    ...extra,
  };
}

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  const dir = join(__dirname, "..", "drizzle");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  setDbForTesting(drizzle(pg, { schema }));
});

beforeEach(() => {
  vi.resetAllMocks();
  m.listOwnedRepos.mockResolvedValue([
    repo(1, "alpha"),
    repo(2, "archived-one", { archived: true, stargazers_count: 0, forks_count: 0 }),
  ] as never);
  m.fetchTraffic.mockResolvedValue({
    window: { views: 30, viewUniques: 7, clones: 3, cloneUniques: 2 },
    views: [
      { timestamp: ts(2), count: 10, uniques: 4 },
      { timestamp: ts(1), count: 20, uniques: 6 },
    ],
    clones: [{ timestamp: ts(1), count: 3, uniques: 2 }],
    referrers: [
      { referrer: "github.com", count: 12, uniques: 5 },
      { referrer: "google.com", count: 8, uniques: 3 },
    ],
    paths: [{ path: "/jan/alpha", title: "alpha", count: 30, uniques: 9 }],
  } as never);
  m.fetchReleases.mockResolvedValue([
    { tag_name: "v1.0.0", assets: [{ id: 99, name: "alpha.zip", download_count: 42 }] },
  ] as never);
  m.fetchStargazers.mockResolvedValue([
    { login: "old-fan", starredAt: "2024-06-01T12:00:00Z" },
    { login: "new-fan", starredAt: ts(3) },
  ]);
  m.fetchForks.mockResolvedValue([
    { forkId: 500, fullName: "someone/alpha", owner: "someone", stars: 1, createdAt: ts(5) },
  ]);
  m.fetchLanguages.mockResolvedValue({ TypeScript: 9000, CSS: 1000 });
  m.fetchViewer.mockResolvedValue({ login: "jan", createdAt: `${new Date().getUTCFullYear()}-01-05T00:00:00Z`, followers: 10, following: 3, publicRepos: 2 });
  m.fetchContributions.mockResolvedValue(contributions(new Date().getUTCFullYear()));
  m.fetchBranchSha.mockResolvedValue("sha-1");
  m.fetchTarball.mockImplementation(() =>
    tarball({ "src/a.ts": lines(80), "src/b.css": lines(20), "package-lock.json": lines(5000), "README.md": lines(50) }),
  );
});

describe("runSync", () => {
  it("collects traffic, snapshots, releases, stars and forks", async () => {
    const result = await runSync();
    expect(result.errors).toEqual([]);
    expect(result.reposSynced).toBe(1); // archived repo has no traffic API
    expect(result.historyPending).toBe(0);
    expect(result.codeStatsPending).toBe(0);

    // Languages + lines counted from the default branch's tarball (lock file and README left out)
    const code = await pg.query<{ lines_of_code: number; code_stats_pushed_at: Date; loc_commit_sha: string }>(
      "select lines_of_code, code_stats_pushed_at, loc_commit_sha from repos where id = 1",
    );
    expect(code.rows[0]).toMatchObject({ lines_of_code: 100, loc_commit_sha: "sha-1" });
    expect(code.rows[0].code_stats_pushed_at).toBeTruthy();
    expect(m.fetchTarball).toHaveBeenCalledWith("jan", "alpha", "sha-1");
    const loc = await pg.query("select language, files, lines, non_blank from repo_loc where repo_id = 1 order by non_blank desc");
    expect(loc.rows).toEqual([
      { language: "TypeScript", files: 1, lines: 160, non_blank: 80 },
      { language: "CSS", files: 1, lines: 40, non_blank: 20 },
    ]);
    const langs = await pg.query<{ language: string; bytes: number }>(
      "select language, bytes::int as bytes from repo_languages where repo_id = 1 order by bytes desc",
    );
    expect(langs.rows).toEqual([
      { language: "TypeScript", bytes: 9000 },
      { language: "CSS", bytes: 1000 },
    ]);

    // Archived repos skip the traffic endpoints
    expect(m.fetchTraffic).toHaveBeenCalledTimes(1);
    expect(m.fetchStargazers).toHaveBeenCalledTimes(1);

    const traffic = await pg.query<{ date: string; views: number; clones: number }>(
      "select date::text, views, clones from traffic_daily order by date",
    );
    expect(traffic.rows).toEqual([
      { date: daysAgo(2), views: 10, clones: 0 },
      { date: daysAgo(1), views: 20, clones: 3 },
    ]);
  });

  it("treats a 403 on stargazers as unavailable star history, not an error", async () => {
    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha", { stargazers_count: 7 })] as never);
    m.fetchStargazers.mockRejectedValue(Object.assign(new Error("Resource not accessible"), { status: 403 }));
    const result = await runSync();
    expect(result.errors).toEqual([]);
    expect(result.starHistoryUnavailable).toEqual(["jan/alpha"]);
    expect(result.reposSynced).toBe(1);
    // Other failures on the same endpoint are still reported
    m.fetchStargazers.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    const again = await runSync();
    expect(again.errors).toEqual([{ repo: "jan/alpha (stars)", error: "boom" }]);
  });

  it("is idempotent and corrects partial days on re-run", async () => {
    m.fetchTraffic.mockResolvedValue({
      window: { views: 35, viewUniques: 8, clones: 0, cloneUniques: 0 },
      views: [{ timestamp: ts(1), count: 25, uniques: 7 }],
      clones: [],
      referrers: [],
      paths: [],
    } as never);
    await runSync();
    const rows = await pg.query<{ views: number }>(`select views from traffic_daily where date = '${daysAgo(1)}'`);
    expect(rows.rows[0].views).toBe(25);
    // Star count unchanged since last run → stargazers not refetched
    expect(m.fetchStargazers).not.toHaveBeenCalled();
    expect(m.fetchForks).not.toHaveBeenCalled();
    // Not pushed since languages/lines were computed → not refetched
    expect(m.fetchLanguages).not.toHaveBeenCalled();
    expect(m.fetchTarball).not.toHaveBeenCalled();
  });

  it("refetches stargazers when the count changes (handles un-stars)", async () => {
    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha", { stargazers_count: 1 })] as never);
    m.fetchStargazers.mockResolvedValue([{ login: "old-fan", starredAt: "2024-06-01T12:00:00Z" }]);
    await runSync();
    const stars = await pg.query<{ login: string }>("select login from star_events where repo_id = 1");
    expect(stars.rows.map((r) => r.login)).toEqual(["old-fan"]);

    // restore 2 stars for later tests
    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha")] as never);
    m.fetchStargazers.mockResolvedValue([
      { login: "old-fan", starredAt: "2024-06-01T12:00:00Z" },
      { login: "new-fan", starredAt: ts(3) },
    ]);
    await runSync();
  });

  it("records per-repo errors without aborting the run", async () => {
    m.fetchTraffic.mockRejectedValueOnce(new Error("Resource not accessible"));
    const result = await runSync();
    expect(result.errors).toEqual([{ repo: "jan/alpha", error: "Resource not accessible" }]);
    expect(result.reposSynced).toBe(0);
  });

  it("defers star/fork backfills past the time budget and resumes next run", async () => {
    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha"), repo(3, "big", { stargazers_count: 2, forks_count: 0 })] as never);
    m.fetchStargazers.mockResolvedValue([
      { login: "a", starredAt: ts(10) },
      { login: "b", starredAt: ts(9) },
    ]);
    const first = await runSync({ timeBudgetMs: -1 }); // already out of time
    expect(first.reposSynced).toBe(2); // traffic always collected
    expect(first.historyPending).toBe(1);
    expect(first.codeStatsPending).toBe(1); // "big" is new, but no tarball downloads once out of time
    expect(m.fetchStargazers).not.toHaveBeenCalled();
    expect(m.fetchLanguages).not.toHaveBeenCalled();

    const second = await runSync({ timeBudgetMs: 60_000 });
    expect(second.historyPending).toBe(0);
    expect(second.codeStatsPending).toBe(0);
    expect(m.fetchStargazers).toHaveBeenCalledWith("jan", "big");
    const rows = await pg.query<{ n: number }>("select count(*)::int as n from star_events where repo_id = 3");
    expect(rows.rows[0].n).toBe(2);

    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha"), repo(2, "archived-one", { archived: true, stargazers_count: 0, forks_count: 0 })] as never);
    await pg.exec("delete from repos where id = 3; delete from star_events where repo_id = 3; delete from traffic_daily where repo_id = 3; delete from traffic_windows where repo_id = 3; delete from referrers where repo_id = 3; delete from popular_paths where repo_id = 3; delete from release_assets where repo_id = 3; delete from repo_snapshots where repo_id = 3; delete from repo_languages where repo_id = 3; delete from repo_loc where repo_id = 3");
    await runSync();
  });
});

describe("dashboard queries", () => {
  it("getOverview aggregates totals, deltas and sparklines", async () => {
    const o = await getOverview(7);
    const alpha = o.repos.find((r) => r.name === "alpha")!;
    expect(alpha.views).toBe(30); // 10 + 20 (latest sync overwrote the corrected day again)
    expect(alpha.clones).toBe(3);
    expect(alpha.stars).toBe(2);
    expect(alpha.starsDelta).toBe(1); // only new-fan starred within 7 days
    expect(alpha.forksDelta).toBe(1);
    expect(alpha.spark).toHaveLength(7);
    expect(alpha.spark.reduce((a, b) => a + b, 0)).toBe(30);
    // Only 2 days of history stored → no full previous 7-day window to compare against
    expect(o.previous).toBeNull();
    expect(o.topReferrers.length).toBeGreaterThanOrEqual(0);
    expect(o.lastRun?.finishedAt).toBeTruthy();
    // GitHub's deduplicated 14-day totals from the latest sync
    expect(o.window14).toEqual({ views: 30, viewUniques: 7, clones: 3, cloneUniques: 2 });
    expect(o.topReferrers[0]).toMatchObject({ referrer: "github.com", count: 12 });
    expect(o.topReferrers[0].trend.at(-1)).toBe(12);
  });

  it("getOverview supports all-time range", async () => {
    const o = await getOverview(0);
    expect(o.previous).toBeNull();
    expect(o.since).toBe(daysAgo(2));
  });

  it("getRepoDetail returns growth history back to repo creation", async () => {
    const d = (await getRepoDetail("jan", "alpha", 0))!;
    expect(d.growth[0]).toMatchObject({ date: "2024-01-01", stars: 0, forks: 0 });
    expect(d.growth.at(-1)).toMatchObject({ stars: 2, forks: 1 });
    expect(d.recentStargazers.map((s) => s.login)).toEqual(["new-fan", "old-fan"]);
    expect(d.recentForks[0].fullName).toBe("someone/alpha");
    expect(d.assets[0]).toMatchObject({ assetName: "alpha.zip", downloads: 42 });
    expect(d.paths[0].path).toBe("/jan/alpha");
    expect(d.window14).toMatchObject({ viewUniques: 7 });
    expect(d.referrerTrend.series.map((s) => s.label)).toEqual(["github.com", "google.com"]);
    expect(d.referrerTrend.data.at(-1)).toMatchObject({ r0: 12, r1: 8 });
  });

  it("getRepoDetail returns null for unknown repos", async () => {
    expect(await getRepoDetail("jan", "nope", 30)).toBeNull();
  });

  it("exports CSV", async () => {
    const repos = await getExportData("repos", 30);
    expect(toCsv(repos as Record<string, unknown>[])).toMatch(/^repo,views,unique_visitors/);
    const daily = await getExportData("daily", 30);
    expect(daily).toHaveLength(2);
    expect(daily[0]).toMatchObject({ repo: "jan/alpha", date: daysAgo(2) });
  });
});

describe("code stats", () => {
  // These run last: they change alpha's pushed_at and languages.
  const pushedNow = `${isoDay()}T12:00:00Z`;

  it("recounts lines only when the default branch has a new commit", async () => {
    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha", { pushed_at: pushedNow })] as never);
    m.fetchLanguages.mockResolvedValue({ Python: 500 });
    // Pushed (e.g. to a feature branch) but main hasn't moved → languages refresh, no download
    const first = await runSync();
    expect(first.errors).toEqual([]);
    expect(first.codeStatsPending).toBe(0);
    expect(m.fetchTarball).not.toHaveBeenCalled();
    const langs = await pg.query<{ language: string }>("select language from repo_languages where repo_id = 1");
    expect(langs.rows.map((r) => r.language)).toEqual(["Python"]);
    const before = await pg.query<{ lines_of_code: number }>("select lines_of_code from repos where id = 1");
    expect(before.rows[0].lines_of_code).toBe(100);

    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha", { pushed_at: `${isoDay()}T13:00:00Z` })] as never);
    m.fetchBranchSha.mockResolvedValue("sha-2");
    m.fetchTarball.mockImplementation(() => tarball({ "app.py": lines(390) }));
    const second = await runSync();
    expect(second.errors).toEqual([]);
    expect(m.fetchTarball).toHaveBeenCalledWith("jan", "alpha", "sha-2");
    const after = await pg.query<{ lines_of_code: number }>("select lines_of_code from repos where id = 1");
    expect(after.rows[0].lines_of_code).toBe(390);
    const loc = await pg.query<{ language: string }>("select language from repo_loc where repo_id = 1");
    expect(loc.rows.map((r) => r.language)).toEqual(["Python"]); // old TypeScript/CSS rows replaced
  });

  it("getOverview totals languages and lines across your own repos, leaving forks out", async () => {
    await pg.exec(`
      insert into repos (id, owner, name, full_name, html_url, fork, lines_of_code)
        values (20, 'jan', 'someone-elses', 'jan/someone-elses', 'https://github.com/jan/someone-elses', true, 999999);
      insert into repo_languages values (20, 'Go', 50000);
    `);
    const o = await getOverview(7);
    expect(o.code.languages.map((l) => l.language)).not.toContain("Go");
    // alpha is now Python; the archived repo still has TypeScript + CSS from the first sync
    expect(o.code.languages).toEqual([
      { language: "TypeScript", bytes: 9000, repos: 1 },
      { language: "CSS", bytes: 1000, repos: 1 },
      { language: "Python", bytes: 500, repos: 1 },
    ]);
    expect(o.code.linesOfCode).toBeLessThan(999999);
    expect(o.code.largest[0]).toMatchObject({ name: "alpha", linesOfCode: 390 });
    expect(o.repos.find((r) => r.name === "alpha")!.likelyAutomated).toBe(false); // 30 views, 3 clones

    const d = (await getRepoDetail("jan", "alpha", 30))!;
    expect(d.languages).toEqual([{ language: "Python", bytes: 500 }]);
    expect(d.likelyAutomated).toBe(false);
  });

  it("reports a failed download as an error and retries on the next run", async () => {
    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha", { pushed_at: `${isoDay()}T15:00:00Z` })] as never);
    m.fetchBranchSha.mockResolvedValue("sha-3");
    m.fetchTarball.mockRejectedValue(new Error("tarball jan/alpha@sha-3: HTTP 502"));
    const r = await runSync();
    expect(r.errors).toEqual([{ repo: "jan/alpha (code stats)", error: "tarball jan/alpha@sha-3: HTTP 502" }]);
    const row = await pg.query<{ lines_of_code: number; loc_commit_sha: string }>("select lines_of_code, loc_commit_sha from repos where id = 1");
    expect(row.rows[0]).toEqual({ lines_of_code: 390, loc_commit_sha: "sha-2" }); // previous count kept
    m.fetchTarball.mockImplementation(() => tarball({ "app.py": lines(400) }));
    await runSync();
    const fixed = await pg.query<{ lines_of_code: number }>("select lines_of_code from repos where id = 1");
    expect(fixed.rows[0].lines_of_code).toBe(400);
  });

  it("counts an empty repo as zero lines and skips downloading very large repos", async () => {
    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha", { pushed_at: `${isoDay()}T18:00:00Z` })] as never);
    m.fetchBranchSha.mockResolvedValue(null);
    expect((await runSync()).errors).toEqual([]);
    const empty = await pg.query<{ lines_of_code: number }>("select lines_of_code from repos where id = 1");
    expect(empty.rows[0].lines_of_code).toBe(0);

    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha", { pushed_at: `${isoDay()}T19:00:00Z`, size: 600 * 1024 })] as never);
    expect((await runSync()).errors).toEqual([]);
    expect(m.fetchTarball).not.toHaveBeenCalled();
    const big = await pg.query<{ lines_of_code: number | null }>("select lines_of_code from repos where id = 1");
    expect(big.rows[0].lines_of_code).toBeNull();
  });
});

describe("contributions", () => {
  it("works out which years still need fetching", () => {
    const created = new Date("2023-06-01T00:00:00Z");
    const now = new Date("2026-03-01T00:00:00Z");
    expect(yearsToFetch(created, now, new Map())).toEqual([2026, 2025, 2024, 2023]);
    const synced = new Map([
      [2023, new Date("2024-02-01T00:00:00Z")], // final
      [2024, new Date("2024-12-30T00:00:00Z")], // synced before the year ended → refetch once
      [2025, new Date("2026-01-10T00:00:00Z")], // final
      [2026, new Date("2026-02-28T00:00:00Z")], // current year → always
    ]);
    expect(yearsToFetch(created, now, synced)).toEqual([2026, 2024]);
  });

  it("backfills every year once, then only the current one, and powers /me", async () => {
    await pg.exec("delete from contribution_years; delete from contribution_days; delete from contribution_repos; delete from profile_snapshots");
    m.fetchViewer.mockResolvedValue({ login: "jan", createdAt: "2024-03-10T00:00:00Z", followers: 12, following: 3, publicRepos: 9 });
    m.fetchContributions.mockImplementation(async (from: Date) => contributions(from.getUTCFullYear(), from.getUTCFullYear() - 2020));
    const now = new Date("2026-02-03T12:00:00Z");

    const first = await syncContributions({ now });
    expect(first).toEqual({ login: "jan", yearsFetched: 3, yearsPending: 0 });
    // The first year starts at account creation, the current one ends now
    const calls = m.fetchContributions.mock.calls.map(([f, t]) => [f.toISOString(), t.toISOString()]);
    expect(calls).toContainEqual(["2024-03-10T00:00:00.000Z", "2024-12-31T23:59:59.000Z"]);
    expect(calls).toContainEqual(["2026-01-01T00:00:00.000Z", "2026-02-03T12:00:00.000Z"]);
    const days = await pg.query<{ n: number }>("select count(*)::int as n from contribution_days where count = 99");
    expect(days.rows[0].n).toBe(0);

    m.fetchContributions.mockClear();
    const second = await syncContributions({ now: new Date("2026-02-04T12:00:00Z") });
    expect(second.yearsFetched).toBe(1);
    expect(m.fetchContributions.mock.calls[0][0].toISOString()).toBe("2026-01-01T00:00:00.000Z");

    // Out of time → nothing fetched, reported as pending
    expect(await syncContributions({ now, outOfTime: () => true })).toMatchObject({ yearsFetched: 0, yearsPending: 1 });

    const me = (await getMe(isoDay(now)))!;
    expect(me.login).toBe("jan");
    // commits per year = year - 2020 → 4 + 5 + 6
    expect(me.totals).toMatchObject({ commits: 15, pullRequests: 3, issues: 9, reviews: 12, total: 39 });
    expect(me.years.map((y) => y.year)).toEqual([2024, 2025, 2026]);
    expect(me.reposContributedTo).toBe(2);
    expect(me.topRepos[0]).toMatchObject({ repo: "jan/alpha", commits: 15, own: true });
    expect(me.streaks).toMatchObject({ current: 2, longest: 2 }); // 2026-02-01 and -02, "today" is 02-03
    expect(me.followers).toMatchObject({ current: 12 });
    expect(me.heatmap.at(-1)!.some((c) => c?.date === "2026-02-02" && c.count === 1)).toBe(true);
  });

  it("reports a failure without breaking the rest of the sync", async () => {
    m.fetchViewer.mockRejectedValue(new Error("Bad credentials"));
    const r = await runSync();
    expect(r.errors).toEqual([{ repo: "contributions", error: "Bad credentials" }]);
    expect(r.reposSynced).toBe(1);
    expect(r.contributionYearsPending).toBeNull();
  });
});
