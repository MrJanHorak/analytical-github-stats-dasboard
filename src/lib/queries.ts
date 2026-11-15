import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { daysAgo } from "./utils";

const { repos, repoSnapshots, trafficDaily, referrers, popularPaths, releaseAssets, syncRuns } = schema;

export type RepoRow = Awaited<ReturnType<typeof getOverview>>["repos"][number];

export async function getOverview(rangeDays: number) {
  const db = getDb();
  const since = daysAgo(rangeDays);

  const [allRepos, traffic, snapshots, daily, lastRun] = await Promise.all([
    db.select().from(repos),
    db
      .select({
        repoId: trafficDaily.repoId,
        views: sql<number>`coalesce(sum(${trafficDaily.views}),0)::int`,
        viewUniques: sql<number>`coalesce(sum(${trafficDaily.viewUniques}),0)::int`,
        clones: sql<number>`coalesce(sum(${trafficDaily.clones}),0)::int`,
        cloneUniques: sql<number>`coalesce(sum(${trafficDaily.cloneUniques}),0)::int`,
      })
      .from(trafficDaily)
      .where(gte(trafficDaily.date, since))
      .groupBy(trafficDaily.repoId),
    db
      .select()
      .from(repoSnapshots)
      .where(gte(repoSnapshots.date, since))
      .orderBy(asc(repoSnapshots.date)),
    db
      .select({
        date: trafficDaily.date,
        views: sql<number>`sum(${trafficDaily.views})::int`,
        viewUniques: sql<number>`sum(${trafficDaily.viewUniques})::int`,
        clones: sql<number>`sum(${trafficDaily.clones})::int`,
        cloneUniques: sql<number>`sum(${trafficDaily.cloneUniques})::int`,
      })
      .from(trafficDaily)
      .where(gte(trafficDaily.date, since))
      .groupBy(trafficDaily.date)
      .orderBy(asc(trafficDaily.date)),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
  ]);

  const trafficBy = new Map(traffic.map((t) => [t.repoId, t]));
  const snapBy = new Map<number, { first: (typeof snapshots)[number]; last: (typeof snapshots)[number] }>();
  for (const s of snapshots) {
    const cur = snapBy.get(s.repoId);
    if (!cur) snapBy.set(s.repoId, { first: s, last: s });
    else cur.last = s;
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
      stars: s?.last.stars ?? 0,
      starsDelta: s ? s.last.stars - s.first.stars : 0,
      forks: s?.last.forks ?? 0,
      forksDelta: s ? s.last.forks - s.first.forks : 0,
    };
  });

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

  const sum = (k: "views" | "viewUniques" | "clones" | "cloneUniques" | "stars" | "forks" | "starsDelta" | "forksDelta") =>
    rows.reduce((a, r) => a + r[k], 0);

  return {
    repos: rows,
    daily,
    topReferrers,
    lastRun: lastRun[0] ?? null,
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
  const since = daysAgo(rangeDays);
  const [repo] = await db.select().from(repos).where(eq(repos.fullName, `${owner}/${name}`)).limit(1);
  if (!repo) return null;

  const latestFor = (table: typeof referrers | typeof popularPaths | typeof releaseAssets) =>
    sql`${table.date} = (select max(date) from ${table} where repo_id = ${repo.id})`;

  const [daily, snapshots, refs, paths, assets, downloadsByDay] = await Promise.all([
    db
      .select()
      .from(trafficDaily)
      .where(and(eq(trafficDaily.repoId, repo.id), gte(trafficDaily.date, since)))
      .orderBy(asc(trafficDaily.date)),
    db
      .select()
      .from(repoSnapshots)
      .where(and(eq(repoSnapshots.repoId, repo.id), gte(repoSnapshots.date, since)))
      .orderBy(asc(repoSnapshots.date)),
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
  ]);

  const totals = daily.reduce(
    (a, d) => ({
      views: a.views + d.views,
      viewUniques: a.viewUniques + d.viewUniques,
      clones: a.clones + d.clones,
      cloneUniques: a.cloneUniques + d.cloneUniques,
    }),
    { views: 0, viewUniques: 0, clones: 0, cloneUniques: 0 },
  );

  return { repo, daily, snapshots, referrers: refs, paths, assets, downloadsByDay, totals };
}
