/**
 * End-to-end check of the collector + dashboard queries against a real (in-memory) Postgres,
 * with the GitHub API mocked. Applies the actual drizzle/ migrations.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, setDbForTesting } from "@/lib/db";
import * as gh from "@/lib/github";
import { getExportData, getOverview, getRepoDetail } from "@/lib/queries";
import { runSync } from "@/lib/sync";
import { toCsv } from "@/lib/transform";
import { daysAgo } from "@/lib/utils";

vi.mock("@/lib/github", () => ({
  listOwnedRepos: vi.fn(),
  fetchTraffic: vi.fn(),
  fetchReleases: vi.fn(),
  fetchStargazers: vi.fn(),
  fetchForks: vi.fn(),
  fetchLanguages: vi.fn(),
  fetchCommitActivity: vi.fn(),
}));
const m = vi.mocked(gh);

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
});

describe("runSync", () => {
  it("collects traffic, snapshots, releases, stars and forks", async () => {
    const result = await runSync();
    expect(result.errors).toEqual([]);
    expect(result.reposSynced).toBe(1); // archived repo has no traffic API
    expect(result.historyPending).toBe(0);

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
    expect(m.fetchStargazers).not.toHaveBeenCalled();

    const second = await runSync({ timeBudgetMs: 60_000 });
    expect(second.historyPending).toBe(0);
    expect(m.fetchStargazers).toHaveBeenCalledWith("jan", "big");
    const rows = await pg.query<{ n: number }>("select count(*)::int as n from star_events where repo_id = 3");
    expect(rows.rows[0].n).toBe(2);

    m.listOwnedRepos.mockResolvedValue([repo(1, "alpha"), repo(2, "archived-one", { archived: true, stargazers_count: 0, forks_count: 0 })] as never);
    await pg.exec("delete from repos where id = 3; delete from star_events where repo_id = 3; delete from traffic_daily where repo_id = 3; delete from traffic_windows where repo_id = 3; delete from referrers where repo_id = 3; delete from popular_paths where repo_id = 3; delete from release_assets where repo_id = 3; delete from repo_snapshots where repo_id = 3");
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
