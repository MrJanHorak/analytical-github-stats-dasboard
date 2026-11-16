import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import {
  aggregateLanguages,
  bucket,
  cumulativeByDay,
  fillDaily,
  joinSeries,
  likelyAutomated,
  pivotReferrers,
} from "./transform";
import { daysAgo, isoDay } from "./utils";

const {
  alerts,
  annotations,
  repos,
  repoLanguages,
  repoSnapshots,
  trafficDaily,
  trafficWindows,
  referrers,
  popularPaths,
  releaseAssets,
  starEvents,
  forkEvents,
  syncRuns,
} = schema;

type Totals = { views: number; viewUniques: number; clones: number; cloneUniques: number };
const ZERO: Totals = { views: 0, viewUniques: 0, clones: 0, cloneUniques: 0 };

const trafficSums = {
  views: sql<number>`coalesce(sum(${trafficDaily.views}),0)::int`,
  viewUniques: sql<number>`coalesce(sum(${trafficDaily.viewUniques}),0)::int`,
  clones: sql<number>`coalesce(sum(${trafficDaily.clones}),0)::int`,
  cloneUniques: sql<number>`coalesce(sum(${trafficDaily.cloneUniques}),0)::int`,
};

/**
 * Resolve the [since, until] window; range 0 = all time (from the earliest stored traffic day).
 * `prevSince` is only set when stored history fully covers the previous equal-length period,
 * so "% vs previous" never compares against a half-empty window.
 */
async function windowFor(rangeDays: number, repoId?: number) {
  const until = isoDay();
  const db = getDb();
  const [row] = await db
    .select({ min: sql<string | null>`min(${trafficDaily.date})::text` })
    .from(trafficDaily)
    .where(repoId ? eq(trafficDaily.repoId, repoId) : undefined);
  const earliest = row?.min ?? until;
  if (rangeDays === 0) return { since: earliest, until, prevSince: null as string | null };
  const prev = daysAgo(rangeDays * 2 - 1);
  return { since: daysAgo(rangeDays - 1), until, prevSince: earliest <= prev ? prev : null };
}

/** GitHub's deduplicated 14-day totals from the most recent sync, per repo. */
async function latestWindows(repoId?: number) {
  return getDb()
    .selectDistinctOn([trafficWindows.repoId])
    .from(trafficWindows)
    .where(repoId ? eq(trafficWindows.repoId, repoId) : undefined)
    .orderBy(trafficWindows.repoId, desc(trafficWindows.date));
}

export type RepoRow = Awaited<ReturnType<typeof getOverview>>["repos"][number];

export async function getOverview(rangeDays: number) {
  const db = getDb();
  const { since, until, prevSince } = await windowFor(rangeDays);

  const [allRepos, traffic, perRepoDaily, daily, prev, latestSnaps, starsGained, forksGained, lastRun, langRows] =
    await Promise.all([
      db.select().from(repos),
      db.select({ repoId: trafficDaily.repoId, ...trafficSums }).from(trafficDaily).where(gte(trafficDaily.date, since)).groupBy(trafficDaily.repoId),
      db
        .select({ repoId: trafficDaily.repoId, date: trafficDaily.date, views: trafficDaily.views })
        .from(trafficDaily)
        .where(gte(trafficDaily.date, since)),
      db
        .select({ date: trafficDaily.date, ...trafficSums })
        .from(trafficDaily)
        .where(gte(trafficDaily.date, since))
        .groupBy(trafficDaily.date)
        .orderBy(asc(trafficDaily.date)),
      prevSince
        ? db.select(trafficSums).from(trafficDaily).where(and(gte(trafficDaily.date, prevSince), lt(trafficDaily.date, since)))
        : Promise.resolve([ZERO]),
      // Latest snapshot per repo = current star/fork counts
      db
        .selectDistinctOn([repoSnapshots.repoId])
        .from(repoSnapshots)
        .orderBy(repoSnapshots.repoId, desc(repoSnapshots.date)),
      db
        .select({ repoId: starEvents.repoId, n: sql<number>`count(*)::int` })
        .from(starEvents)
        .where(gte(starEvents.starredAt, new Date(since + "T00:00:00Z")))
        .groupBy(starEvents.repoId),
      db
        .select({ repoId: forkEvents.repoId, n: sql<number>`count(*)::int` })
        .from(forkEvents)
        .where(gte(forkEvents.createdAt, new Date(since + "T00:00:00Z")))
        .groupBy(forkEvents.repoId),
      db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
      db.select().from(repoLanguages),
    ]);

  const trafficBy = new Map(traffic.map((t) => [t.repoId, t]));
  const snapBy = new Map(latestSnaps.map((s) => [s.repoId, s]));
  const starsBy = new Map(starsGained.map((s) => [s.repoId, s.n]));
  const forksBy = new Map(forksGained.map((s) => [s.repoId, s.n]));
  const dailyBy = new Map<number, { date: string; views: number }[]>();
  for (const d of perRepoDaily) {
    if (!dailyBy.has(d.repoId)) dailyBy.set(d.repoId, []);
    dailyBy.get(d.repoId)!.push(d);
  }

  const rows = allRepos.map((r) => {
    const t = trafficBy.get(r.id);
    const s = snapBy.get(r.id);
    return {
      ...r,
      views: t?.views ?? 0,
      viewUniques: t?.viewUniques ?? 0,
      clones: t?.clones ?? 0,
      cloneUniques: t?.cloneUniques ?? 0,
      stars: s?.stars ?? 0,
      starsDelta: starsBy.get(r.id) ?? 0,
      forks: s?.forks ?? 0,
      forksDelta: forksBy.get(r.id) ?? 0,
      spark: bucket(fillDaily(dailyBy.get(r.id) ?? [], "views", since, until), 60),
      likelyAutomated: likelyAutomated({ views: t?.views ?? 0, clones: t?.clones ?? 0 }),
    };
  });

  // Code totals cover your own work: forks are left out (their code is mostly someone else's).
  const ownIds = new Set(allRepos.filter((r) => !r.isFork).map((r) => r.id));
  const ownRepos = rows.filter((r) => ownIds.has(r.id));
  const withLines = ownRepos.filter((r) => r.linesOfCode !== null);
  const code = {
    languages: aggregateLanguages(langRows.filter((l) => ownIds.has(l.repoId))),
    linesOfCode: withLines.reduce((a, r) => a + (r.linesOfCode ?? 0), 0),
    reposWithLines: withLines.length,
    reposCounted: ownRepos.length,
    largest: [...withLines]
      .sort((a, b) => (b.linesOfCode ?? 0) - (a.linesOfCode ?? 0))
      .slice(0, 8)
      .map((r) => ({ fullName: r.fullName, name: r.name, linesOfCode: r.linesOfCode ?? 0, language: r.language })),
  };

  const topReferrers = await db
    .select({
      referrer: referrers.referrer,
      count: sql<number>`sum(${referrers.count})::int`,
      uniques: sql<number>`sum(${referrers.uniques})::int`,
    })
    .from(referrers)
    .where(sql`${referrers.date} = (select max(date) from referrers)`)
    .groupBy(referrers.referrer)
    .orderBy(desc(sql`sum(${referrers.count})`))
    .limit(10);

  // Referrer trend: each sync stores GitHub's rolling 14-day referrer counts, one row per day.
  const trendRows = topReferrers.length
    ? await db
        .select({ date: referrers.date, referrer: referrers.referrer, count: sql<number>`sum(${referrers.count})::int` })
        .from(referrers)
        .where(and(gte(referrers.date, since), inArray(referrers.referrer, topReferrers.map((r) => r.referrer))))
        .groupBy(referrers.date, referrers.referrer)
    : [];
  const trendBy = new Map<string, { date: string; count: number }[]>();
  for (const t of trendRows) {
    if (!trendBy.has(t.referrer)) trendBy.set(t.referrer, []);
    trendBy.get(t.referrer)!.push(t);
  }
  const referrerTrends = topReferrers.map((r) => ({
    ...r,
    trend: bucket(fillDaily(trendBy.get(r.referrer) ?? [], "count", since, until), 30),
  }));

  const windows = await latestWindows();
  const window14 = windows.reduce(
    (a, w) => ({
      views: a.views + w.views,
      viewUniques: a.viewUniques + w.viewUniques,
      clones: a.clones + w.clones,
      cloneUniques: a.cloneUniques + w.cloneUniques,
    }),
    { ...ZERO },
  );

  const [recentAlerts, notes] = await Promise.all([
    db
      .select({ alert: alerts, fullName: repos.fullName })
      .from(alerts)
      .innerJoin(repos, eq(repos.id, alerts.repoId))
      .where(gte(alerts.date, since))
      .orderBy(desc(alerts.date), desc(alerts.id))
      .limit(8),
    db
      .select({ date: annotations.date, label: annotations.label, name: repos.name })
      .from(annotations)
      .innerJoin(repos, eq(repos.id, annotations.repoId))
      .where(gte(annotations.date, since))
      .orderBy(asc(annotations.date)),
  ]);

  const sum = (k: "views" | "viewUniques" | "clones" | "cloneUniques" | "stars" | "forks" | "starsDelta" | "forksDelta") =>
    rows.reduce((a, r) => a + r[k], 0);

  return {
    since,
    recentAlerts: recentAlerts.map((a) => ({ ...a.alert, fullName: a.fullName })),
    /** Chart markers across all repos */
    markers: notes.map((n) => ({ date: n.date, label: `${n.name}: ${n.label}` })),
    repos: rows,
    daily,
    topReferrers: referrerTrends,
    /** Sum of each repo's GitHub-deduplicated 14-day totals (null until the first sync stores them) */
    window14: windows.length ? window14 : null,
    lastRun: lastRun[0] ?? null,
    previous: prevSince ? prev[0] ?? ZERO : null,
    code,
    /** Clones in repos whose clone/view pattern looks automated (CI, mirrors, deploys) — a heuristic */
    automatedClones: rows.filter((r) => r.likelyAutomated).reduce((a, r) => a + r.clones, 0),
    totals: {
      views: sum("views"),
      viewUniques: sum("viewUniques"),
      clones: sum("clones"),
      cloneUniques: sum("cloneUniques"),
      stars: sum("stars"),
      starsDelta: sum("starsDelta"),
      forks: sum("forks"),
      forksDelta: sum("forksDelta"),
    },
  };
}

export async function getRepoDetail(owner: string, name: string, rangeDays: number) {
  const db = getDb();
  const [repo] = await db.select().from(repos).where(eq(repos.fullName, `${owner}/${name}`)).limit(1);
  if (!repo) return null;
  const { since, until, prevSince } = await windowFor(rangeDays, repo.id);

  const latestFor = (table: typeof referrers | typeof popularPaths | typeof releaseAssets) =>
    sql`${table.date} = (select max(date) from ${table} where repo_id = ${repo.id})`;

  const [daily, prev, latestSnap, refs, paths, assets, downloadsByDay, stars, forks, windows, refHistory, notes, repoAlerts, langs] = await Promise.all([
    db
      .select()
      .from(trafficDaily)
      .where(and(eq(trafficDaily.repoId, repo.id), gte(trafficDaily.date, since)))
      .orderBy(asc(trafficDaily.date)),
    prevSince
      ? db
          .select(trafficSums)
          .from(trafficDaily)
          .where(and(eq(trafficDaily.repoId, repo.id), gte(trafficDaily.date, prevSince), lt(trafficDaily.date, since)))
      : Promise.resolve([ZERO]),
    db.select().from(repoSnapshots).where(eq(repoSnapshots.repoId, repo.id)).orderBy(desc(repoSnapshots.date)).limit(1),
    db
      .select()
      .from(referrers)
      .where(and(eq(referrers.repoId, repo.id), latestFor(referrers)))
      .orderBy(desc(referrers.count)),
    db
      .select()
      .from(popularPaths)
      .where(and(eq(popularPaths.repoId, repo.id), latestFor(popularPaths)))
      .orderBy(desc(popularPaths.count)),
    db
      .select()
      .from(releaseAssets)
      .where(and(eq(releaseAssets.repoId, repo.id), latestFor(releaseAssets)))
      .orderBy(desc(releaseAssets.downloads)),
    db
      .select({ date: releaseAssets.date, downloads: sql<number>`sum(${releaseAssets.downloads})::int` })
      .from(releaseAssets)
      .where(and(eq(releaseAssets.repoId, repo.id), gte(releaseAssets.date, since)))
      .groupBy(releaseAssets.date)
      .orderBy(asc(releaseAssets.date)),
    db.select().from(starEvents).where(eq(starEvents.repoId, repo.id)).orderBy(desc(starEvents.starredAt)),
    db.select().from(forkEvents).where(eq(forkEvents.repoId, repo.id)).orderBy(desc(forkEvents.createdAt)),
    latestWindows(repo.id),
    db
      .select({ date: referrers.date, referrer: referrers.referrer, count: referrers.count })
      .from(referrers)
      .where(and(eq(referrers.repoId, repo.id), gte(referrers.date, since))),
    db.select().from(annotations).where(eq(annotations.repoId, repo.id)).orderBy(desc(annotations.date), desc(annotations.id)),
    db.select().from(alerts).where(eq(alerts.repoId, repo.id)).orderBy(desc(alerts.date), desc(alerts.id)).limit(20),
    db
      .select({ language: repoLanguages.language, bytes: repoLanguages.bytes })
      .from(repoLanguages)
      .where(eq(repoLanguages.repoId, repo.id))
      .orderBy(desc(repoLanguages.bytes)),
  ]);

  // Trend for the referrers that matter most right now (top 5 in the latest window)
  const referrerTrend = pivotReferrers(
    refHistory,
    refs.slice(0, 5).map((r) => r.referrer),
  );

  const totals = daily.reduce(
    (a, d) => ({
      views: a.views + d.views,
      viewUniques: a.viewUniques + d.viewUniques,
      clones: a.clones + d.clones,
      cloneUniques: a.cloneUniques + d.cloneUniques,
    }),
    { ...ZERO },
  );

  // Star/fork growth comes from event timestamps, so it reaches back before the app existed.
  // "All time" starts at repo creation rather than first traffic day.
  const historySince = rangeDays === 0 && repo.createdAt ? isoDay(repo.createdAt) : since;
  const sinceTs = new Date(since + "T00:00:00Z");
  const growth = joinSeries({
    stars: cumulativeByDay(stars.map((s) => s.starredAt), historySince, until),
    forks: cumulativeByDay(forks.map((f) => f.createdAt), historySince, until),
  });

  return {
    repo,
    daily,
    totals,
    previous: prevSince ? prev[0] ?? ZERO : null,
    likelyAutomated: likelyAutomated(totals),
    /** Stored by the sync; empty until the first sync that computes code stats */
    languages: langs,
    window14: windows[0] ?? null,
    referrerTrend,
    notes,
    alerts: repoAlerts,
    /** Notes + alerts inside the current window, for chart reference lines */
    markers: [
      ...notes.filter((n) => n.date >= since).map((n) => ({ date: n.date, label: n.label, kind: "note" as const })),
      ...repoAlerts.filter((a) => a.date >= since).map((a) => ({ date: a.date, label: alertShortLabel(a.kind), kind: "alert" as const })),
    ],
    current: { stars: latestSnap[0]?.stars ?? stars.length, forks: latestSnap[0]?.forks ?? forks.length },
    starsGained: stars.filter((s) => s.starredAt >= sinceTs).length,
    forksGained: forks.filter((f) => f.createdAt >= sinceTs).length,
    growth,
    recentStargazers: stars.slice(0, 12),
    recentForks: forks.slice(0, 12),
    referrers: refs,
    paths,
    assets,
    downloadsByDay,
  };
}

export function alertShortLabel(kind: string) {
  if (kind === "views_spike") return "views spike";
  if (kind === "clones_spike") return "clones spike";
  if (kind === "stars_burst") return "star burst";
  if (kind.startsWith("stars_milestone_")) return `${kind.split("_").at(-1)} ★`;
  return kind;
}

/** Rows for CSV export. */
export async function getExportData(kind: "repos" | "daily", rangeDays: number) {
  const db = getDb();
  if (kind === "repos") {
    const o = await getOverview(rangeDays);
    return o.repos.map(({ spark: _spark, ...r }) => ({
      repo: r.fullName,
      views: r.views,
      unique_visitors: r.viewUniques,
      clones: r.clones,
      unique_cloners: r.cloneUniques,
      stars: r.stars,
      stars_gained: r.starsDelta,
      forks: r.forks,
      forks_gained: r.forksDelta,
      private: r.isPrivate,
      fork: r.isFork,
      language: r.language,
      lines_of_code: r.linesOfCode,
      likely_automated_clones: r.likelyAutomated,
      pushed_at: r.pushedAt,
      since: o.since,
    }));
  }
  const { since } = await windowFor(rangeDays);
  return db
    .select({
      date: trafficDaily.date,
      repo: repos.fullName,
      views: trafficDaily.views,
      unique_visitors: trafficDaily.viewUniques,
      clones: trafficDaily.clones,
      unique_cloners: trafficDaily.cloneUniques,
    })
    .from(trafficDaily)
    .innerJoin(repos, eq(repos.id, trafficDaily.repoId))
    .where(gte(trafficDaily.date, since))
    .orderBy(asc(trafficDaily.date), asc(repos.fullName));
}
