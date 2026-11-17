import { and, asc, desc, eq, gte, inArray, lt, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { getDb, schema } from "./db";
import { alertConfigFromEnv, effectiveConfig } from "./alerts";
import { CATEGORIES } from "./frameworks";
import {
  aggregateContributedRepos,
  aggregateFrameworks,
  aggregateLanguages,
  bucket,
  ciStats,
  codeHistory,
  contributionStreaks,
  deployStats,
  cumulativeByDay,
  fillDaily,
  heatmapWeeks,
  isOutdated,
  isOutside,
  issueFlow,
  joinSeries,
  outdatedFrameworks,
  weeklyIssueFlow,
  likelyAutomated,
  pivotReferrers,
} from "./transform";
import { daysAgo, isoDay } from "./utils";

const {
  alerts,
  annotations,
  repos,
  repoLanguages,
  repoFrameworks,
  repoLoc,
  repoSnapshots,
  trafficDaily,
  trafficWindows,
  referrers,
  popularPaths,
  releaseAssets,
  starEvents,
  forkEvents,
  syncRuns,
  contributionDays,
  contributionYears,
  contributionRepos,
  profileSnapshots,
  issues,
  workflowRuns,
  repoHealth,
  codeSnapshots,
  deployments,
  packageVersions,
  releases,
  alertSettings,
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
/**
 * What a viewer may see. `null` fields mean everything (single-user mode). In sign-in (App) mode:
 * the repos of the installations the signed-in user can access, and their own login.
 */
export type Scope = { repoIds: number[] | null; logins: string[] | null; installationIds: number[] | null };
export const ALL_SCOPE: Scope = { repoIds: null, logins: null, installationIds: null };

/** A filter on a repo_id column for the scope (undefined = no filter; empty scope = match nothing). */
const repoFilter = (scope: Scope, col: AnyColumn) =>
  scope.repoIds === null ? undefined : scope.repoIds.length ? inArray(col, scope.repoIds) : sql`false`;
/** True when the scope may see this repo. */
export const canSeeRepo = (scope: Scope, repoId: number) => scope.repoIds === null || scope.repoIds.includes(repoId);

async function windowFor(rangeDays: number, filter?: SQL) {
  const until = isoDay();
  const db = getDb();
  const [row] = await db
    .select({ min: sql<string | null>`min(${trafficDaily.date})::text` })
    .from(trafficDaily)
    .where(filter);
  const earliest = row?.min ?? until;
  if (rangeDays === 0) return { since: earliest, until, prevSince: null as string | null };
  const prev = daysAgo(rangeDays * 2 - 1);
  return { since: daysAgo(rangeDays - 1), until, prevSince: earliest <= prev ? prev : null };
}

/** GitHub's deduplicated 14-day totals from the most recent sync, per repo. */
async function latestWindows(filter?: SQL) {
  return getDb()
    .selectDistinctOn([trafficWindows.repoId])
    .from(trafficWindows)
    .where(filter)
    .orderBy(trafficWindows.repoId, desc(trafficWindows.date));
}

export type RepoRow = Awaited<ReturnType<typeof getOverview>>["repos"][number];

/**
 * Issues/PRs, Actions runs and health for the range: everything needed by the overview (all your
 * repos) or one repo's detail page. Only items touched in the range, plus what's open now, are read.
 */
async function loadActivity(since: string, until: string, forRepo: (col: AnyColumn) => SQL | undefined) {
  const db = getDb();
  const sinceTs = new Date(since + "T00:00:00Z");
  const [issueRows, runRows, healthRows] = await Promise.all([
    db
      .select({
        repoId: issues.repoId,
        number: issues.number,
        title: issues.title,
        isPr: issues.isPr,
        state: issues.state,
        author: issues.author,
        authorAssociation: issues.authorAssociation,
        isBot: issues.isBot,
        createdAt: issues.createdAt,
        closedAt: issues.closedAt,
        mergedAt: issues.mergedAt,
      })
      .from(issues)
      .where(
        and(
          forRepo(issues.repoId),
          or(gte(issues.createdAt, sinceTs), gte(issues.closedAt, sinceTs), eq(issues.state, "open")),
        ),
      ),
    db
      .select({
        repoId: workflowRuns.repoId,
        repo: repos.fullName,
        workflow: workflowRuns.workflow,
        branch: workflowRuns.branch,
        status: workflowRuns.status,
        conclusion: workflowRuns.conclusion,
        createdAt: workflowRuns.createdAt,
        startedAt: workflowRuns.startedAt,
        updatedAt: workflowRuns.updatedAt,
      })
      .from(workflowRuns)
      .innerJoin(repos, eq(repos.id, workflowRuns.repoId))
      .where(and(forRepo(workflowRuns.repoId), gte(workflowRuns.createdAt, sinceTs))),
    db.select().from(repoHealth).where(forRepo(repoHealth.repoId)),
  ]);
  return {
    issueRows,
    runRows,
    healthRows,
    flow: issueFlow(issueRows, sinceTs),
    weekly: weeklyIssueFlow(issueRows, since, until),
    /** True once the activity sync has run for at least one repo */
    synced: healthRows.some((h) => h.activitySyncedAt),
    actionsAvailable: healthRows.some((h) => h.actionsAvailable),
    /** Repos whose issues/PRs the token can't read (missing Issues / Pull requests permission) */
    issuesUnavailable: healthRows.filter((h) => h.issuesAvailable === false).length,
  };
}

/**
 * Code health for the range — test lines and TODOs, lines over time (from daily snapshots), frameworks
 * behind their latest major, deployments — for all `repoIds` (overview) or one repo (detail).
 */
async function loadCodeHealth(since: string, until: string, repoIds: number[]) {
  const db = getDb();
  if (!repoIds.length) return null;
  const sinceTs = new Date(since + "T00:00:00Z");
  const [counts, snaps, fw, latestRows, deps, health] = await Promise.all([
    db
      .select({ id: repos.id, testLines: repos.testLines, todoCount: repos.todoCount, linesOfCode: repos.linesOfCode })
      .from(repos)
      .where(inArray(repos.id, repoIds)),
    db
      .select({ repoId: codeSnapshots.repoId, date: codeSnapshots.date, linesOfCode: codeSnapshots.linesOfCode, testLines: codeSnapshots.testLines })
      .from(codeSnapshots)
      .where(inArray(codeSnapshots.repoId, repoIds)),
    db
      .select({
        repo: repos.name,
        framework: repoFrameworks.framework,
        version: repoFrameworks.version,
        package: repoFrameworks.package,
        ecosystem: repoFrameworks.ecosystem,
      })
      .from(repoFrameworks)
      .innerJoin(repos, eq(repos.id, repoFrameworks.repoId))
      .where(inArray(repoFrameworks.repoId, repoIds)),
    db.select().from(packageVersions),
    db
      .select({ repo: repos.name, production: deployments.production, state: deployments.state, createdAt: deployments.createdAt })
      .from(deployments)
      .innerJoin(repos, eq(repos.id, deployments.repoId))
      .where(and(inArray(deployments.repoId, repoIds), gte(deployments.createdAt, sinceTs))),
    db.select({ available: repoHealth.deploymentsAvailable }).from(repoHealth).where(inArray(repoHealth.repoId, repoIds)),
  ]);
  const latest = new Map(latestRows.map((l) => [`${l.ecosystem}:${l.package}`, l.latest]));
  const counted = counts.filter((c) => c.testLines !== null);
  const testLines = counted.reduce((a, c) => a + (c.testLines ?? 0), 0);
  const codeLines = counted.reduce((a, c) => a + (c.linesOfCode ?? 0), 0);
  const anyDeployAccess = health.some((h) => h.available);
  return {
    health: counted.length
      ? {
          testLines,
          /** Share of counted lines that are tests */
          testRatio: codeLines ? testLines / codeLines : null,
          todos: counted.reduce((a, c) => a + (c.todoCount ?? 0), 0),
          reposWithTests: counted.filter((c) => (c.testLines ?? 0) > 0).length,
          reposCounted: counted.length,
        }
      : null,
    history: codeHistory(snaps, since, until),
    outdated: outdatedFrameworks(fw, latest),
    latest,
    /** null when the token can't read deployments for any of these repos */
    deploys: anyDeployAccess || deps.length ? deployStats(deps, since, until) : null,
    deployPermissionMissing: health.length > 0 && health.every((h) => h.available === false),
  };
}

const alertTotal = (h: typeof repoHealth.$inferSelect | undefined) =>
  !h || h.dependabotHigh === null
    ? null
    : (h.dependabotCritical ?? 0) + (h.dependabotHigh ?? 0) + (h.dependabotMedium ?? 0) + (h.dependabotLow ?? 0);

export async function getOverview(rangeDays: number, scope: Scope = ALL_SCOPE) {
  const db = getDb();
  const inScope = (col: AnyColumn) => repoFilter(scope, col);
  const { since, until, prevSince } = await windowFor(rangeDays, inScope(trafficDaily.repoId));

  const [allRepos, traffic, perRepoDaily, daily, prev, latestSnaps, starsGained, forksGained, lastRun, langRows, locRows, fwRows] =
    await Promise.all([
      db.select().from(repos).where(inScope(repos.id)),
      db
        .select({ repoId: trafficDaily.repoId, ...trafficSums })
        .from(trafficDaily)
        .where(and(gte(trafficDaily.date, since), inScope(trafficDaily.repoId)))
        .groupBy(trafficDaily.repoId),
      db
        .select({ repoId: trafficDaily.repoId, date: trafficDaily.date, views: trafficDaily.views })
        .from(trafficDaily)
        .where(and(gte(trafficDaily.date, since), inScope(trafficDaily.repoId))),
      db
        .select({ date: trafficDaily.date, ...trafficSums })
        .from(trafficDaily)
        .where(and(gte(trafficDaily.date, since), inScope(trafficDaily.repoId)))
        .groupBy(trafficDaily.date)
        .orderBy(asc(trafficDaily.date)),
      prevSince
        ? db
            .select(trafficSums)
            .from(trafficDaily)
            .where(and(gte(trafficDaily.date, prevSince), lt(trafficDaily.date, since), inScope(trafficDaily.repoId)))
        : Promise.resolve([ZERO]),
      // Latest snapshot per repo = current star/fork counts
      db
        .selectDistinctOn([repoSnapshots.repoId])
        .from(repoSnapshots)
        .where(inScope(repoSnapshots.repoId))
        .orderBy(repoSnapshots.repoId, desc(repoSnapshots.date)),
      db
        .select({ repoId: starEvents.repoId, n: sql<number>`count(*)::int` })
        .from(starEvents)
        .where(and(gte(starEvents.starredAt, new Date(since + "T00:00:00Z")), inScope(starEvents.repoId)))
        .groupBy(starEvents.repoId),
      db
        .select({ repoId: forkEvents.repoId, n: sql<number>`count(*)::int` })
        .from(forkEvents)
        .where(and(gte(forkEvents.createdAt, new Date(since + "T00:00:00Z")), inScope(forkEvents.repoId)))
        .groupBy(forkEvents.repoId),
      db
        .select()
        .from(syncRuns)
        .where(
          scope.installationIds === null
            ? undefined
            : scope.installationIds.length
              ? inArray(syncRuns.installationId, scope.installationIds)
              : sql`false`,
        )
        .orderBy(desc(syncRuns.startedAt))
        .limit(1),
      db.select().from(repoLanguages).where(inScope(repoLanguages.repoId)),
      db.select({ repoId: repoLoc.repoId, language: repoLoc.language, bytes: repoLoc.nonBlank }).from(repoLoc).where(inScope(repoLoc.repoId)),
      db.select().from(repoFrameworks).where(inScope(repoFrameworks.repoId)),
    ]);

  const activity = await loadActivity(since, until, inScope);
  const healthBy = new Map(activity.healthRows.map((h) => [h.repoId, h]));
  const runsBy = new Map<number, typeof activity.runRows>();
  for (const r of activity.runRows) {
    if (!runsBy.has(r.repoId)) runsBy.set(r.repoId, []);
    runsBy.get(r.repoId)!.push(r);
  }
  const frameworksBy = new Map<number, string[]>();
  for (const f of fwRows) frameworksBy.set(f.repoId, [...(frameworksBy.get(f.repoId) ?? []), f.framework]);
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
      /** GitHub community health %, null when unknown (private repos, or not synced yet) */
      health: healthBy.get(r.id)?.healthPercentage ?? null,
      /** Actions pass rate in the range (0–1), null without runs */
      ciPassRate: runsBy.has(r.id) ? ciStats(runsBy.get(r.id)!, new Date(since + "T00:00:00Z")).passRate : null,
      /** Open Dependabot alerts, null when unavailable */
      securityAlerts: alertTotal(healthBy.get(r.id)),
      /** Frameworks & tools detected in the repo (names) */
      frameworks: frameworksBy.get(r.id) ?? [],
    };
  });

  // Code totals cover your own work: forks are left out (their code is mostly someone else's).
  const ownIds = new Set(allRepos.filter((r) => !r.isFork).map((r) => r.id));
  const ownRepos = rows.filter((r) => ownIds.has(r.id));
  const withLines = ownRepos.filter((r) => r.linesOfCode !== null);
  const codeHealth = await loadCodeHealth(since, until, [...ownIds]);
  const code = {
    languages: aggregateLanguages(langRows.filter((l) => ownIds.has(l.repoId))),
    /** Non-blank lines per language (in the `bytes` field, so the same helpers/components work) */
    linesByLanguage: aggregateLanguages(locRows.filter((l) => ownIds.has(l.repoId))),
    /** Frameworks & tools across your repos (forks excluded), by category */
    frameworks: aggregateFrameworks(fwRows.filter((f) => ownIds.has(f.repoId)), CATEGORIES),
    linesOfCode: withLines.reduce((a, r) => a + (r.linesOfCode ?? 0), 0),
    reposWithLines: withLines.length,
    reposCounted: ownRepos.length,
    /** Test lines, TODOs (null before the first recount) */
    health: codeHealth?.health ?? null,
    /** Total lines over time, from daily snapshots */
    history: codeHealth?.history ?? [],
    /** Frameworks declared a major version behind the latest release */
    outdated: codeHealth?.outdated ?? [],
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
    .where(
      and(
        inScope(referrers.repoId),
        scope.repoIds === null
          ? sql`${referrers.date} = (select max(date) from referrers)`
          : scope.repoIds.length
            ? sql`${referrers.date} = (select max(date) from referrers where repo_id in (${sql.join(scope.repoIds.map((id) => sql`${id}`), sql`, `)}))`
            : sql`false`,
      ),
    )
    .groupBy(referrers.referrer)
    .orderBy(desc(sql`sum(${referrers.count})`))
    .limit(10);

  // Referrer trend: each sync stores GitHub's rolling 14-day referrer counts, one row per day.
  const trendRows = topReferrers.length
    ? await db
        .select({ date: referrers.date, referrer: referrers.referrer, count: sql<number>`sum(${referrers.count})::int` })
        .from(referrers)
        .where(and(gte(referrers.date, since), inArray(referrers.referrer, topReferrers.map((r) => r.referrer)), inScope(referrers.repoId)))
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

  const windows = await latestWindows(inScope(trafficWindows.repoId));
  const window14 = windows.reduce(
    (a, w) => ({
      views: a.views + w.views,
      viewUniques: a.viewUniques + w.viewUniques,
      clones: a.clones + w.clones,
      cloneUniques: a.cloneUniques + w.cloneUniques,
    }),
    { ...ZERO },
  );

  const [recentAlerts, notes, releaseRows] = await Promise.all([
    db
      .select({ alert: alerts, fullName: repos.fullName })
      .from(alerts)
      .innerJoin(repos, eq(repos.id, alerts.repoId))
      .where(and(gte(alerts.date, since), inScope(alerts.repoId)))
      .orderBy(desc(alerts.date), desc(alerts.id))
      .limit(8),
    db
      .select({ date: annotations.date, label: annotations.label, name: repos.name })
      .from(annotations)
      .innerJoin(repos, eq(repos.id, annotations.repoId))
      .where(and(gte(annotations.date, since), inScope(annotations.repoId)))
      .orderBy(asc(annotations.date)),
    // Releases of your own repos (pre-releases left out to keep the overview chart readable)
    db
      .select({ publishedAt: releases.publishedAt, tag: releases.tag, name: repos.name })
      .from(releases)
      .innerJoin(repos, eq(repos.id, releases.repoId))
      .where(
        and(gte(releases.publishedAt, new Date(since + "T00:00:00Z")), eq(releases.prerelease, false), eq(repos.isFork, false), inScope(releases.repoId)),
      )
      .orderBy(asc(releases.publishedAt)),
  ]);

  const sum = (k: "views" | "viewUniques" | "clones" | "cloneUniques" | "stars" | "forks" | "starsDelta" | "forksDelta") =>
    rows.reduce((a, r) => a + r[k], 0);

  return {
    since,
    recentAlerts: recentAlerts.map((a) => ({ ...a.alert, fullName: a.fullName })),
    /** Chart markers across all repos */
    markers: [
      ...notes.map((n) => ({ date: n.date, label: `${n.name}: ${n.label}`, kind: "note" as const })),
      ...releaseRows.map((r) => ({ date: isoDay(r.publishedAt), label: `🚀 ${r.name} ${r.tag}`, kind: "release" as const })),
    ],
    repos: rows,
    daily,
    topReferrers: referrerTrends,
    /** Sum of each repo's GitHub-deduplicated 14-day totals (null until the first sync stores them) */
    window14: windows.length ? window14 : null,
    lastRun: lastRun[0] ?? null,
    previous: prevSince ? prev[0] ?? ZERO : null,
    code,
    /** Deployments across your repos; null when the token can't read them */
    deploys: codeHealth?.deploys ?? null,
    deployPermissionMissing: codeHealth?.deployPermissionMissing ?? false,
    activity: {
      synced: activity.synced,
      flow: activity.flow,
      weekly: activity.weekly,
      issuesUnavailable: activity.issuesUnavailable,
      ci: activity.actionsAvailable ? ciStats(activity.runRows, new Date(since + "T00:00:00Z")) : null,
      security: (() => {
        const known = activity.healthRows.filter((h) => h.dependabotHigh !== null && ownIds.has(h.repoId));
        if (!known.length) return null;
        const sumSev = (k: "dependabotCritical" | "dependabotHigh" | "dependabotMedium" | "dependabotLow") =>
          known.reduce((a, h) => a + (h[k] ?? 0), 0);
        return {
          critical: sumSev("dependabotCritical"),
          high: sumSev("dependabotHigh"),
          medium: sumSev("dependabotMedium"),
          low: sumSev("dependabotLow"),
          reposChecked: known.length,
          repos: rows
            .filter((r) => (r.securityAlerts ?? 0) > 0)
            .sort((a, b) => (b.securityAlerts ?? 0) - (a.securityAlerts ?? 0))
            .map((r) => ({ fullName: r.fullName, name: r.name, alerts: r.securityAlerts ?? 0 })),
        };
      })(),
    },
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

export async function getRepoDetail(owner: string, name: string, rangeDays: number, scope: Scope = ALL_SCOPE) {
  const db = getDb();
  const [repo] = await db.select().from(repos).where(eq(repos.fullName, `${owner}/${name}`)).limit(1);
  if (!repo || !canSeeRepo(scope, repo.id)) return null;
  const { since, until, prevSince } = await windowFor(rangeDays, eq(trafficDaily.repoId, repo.id));
  const activity = await loadActivity(since, until, (col) => eq(col, repo.id));
  const codeHealth = await loadCodeHealth(since, until, [repo.id]);

  const latestFor = (table: typeof referrers | typeof popularPaths | typeof releaseAssets) =>
    sql`${table.date} = (select max(date) from ${table} where repo_id = ${repo.id})`;

  const [daily, prev, latestSnap, refs, paths, assets, downloadsByDay, stars, forks, windows, refHistory, notes, repoAlerts, langs, loc, frameworks, repoReleases, override] = await Promise.all([
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
    latestWindows(eq(trafficWindows.repoId, repo.id)),
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
    db
      .select({ language: repoLoc.language, files: repoLoc.files, lines: repoLoc.lines, nonBlank: repoLoc.nonBlank })
      .from(repoLoc)
      .where(eq(repoLoc.repoId, repo.id))
      .orderBy(desc(repoLoc.nonBlank)),
    db
      .select({
        name: repoFrameworks.framework,
        category: repoFrameworks.category,
        version: repoFrameworks.version,
        package: repoFrameworks.package,
        ecosystem: repoFrameworks.ecosystem,
      })
      .from(repoFrameworks)
      .where(eq(repoFrameworks.repoId, repo.id)),
    db.select().from(releases).where(eq(releases.repoId, repo.id)).orderBy(desc(releases.publishedAt)),
    db.select().from(alertSettings).where(eq(alertSettings.repoId, repo.id)).limit(1),
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
    /** Lines of code per language on the default branch; empty until counted */
    loc,
    /** Frameworks & tools, in category order, with the latest release and whether this repo is a major behind */
    frameworks: frameworks
      .sort(
        (a, b) =>
          CATEGORIES.indexOf(a.category as (typeof CATEGORIES)[number]) - CATEGORIES.indexOf(b.category as (typeof CATEGORIES)[number]) ||
          a.name.localeCompare(b.name),
      )
      .map((f) => {
        const latest = (f.package && codeHealth?.latest.get(`${f.ecosystem}:${f.package}`)) || null;
        return { name: f.name, category: f.category, version: f.version, latest, outdated: isOutdated(f.version, latest) };
      }),
    /** Lines and test lines over the range, from daily snapshots */
    codeHistory: codeHealth?.history ?? [],
    deploys: codeHealth?.deploys ?? null,
    deployPermissionMissing: codeHealth?.deployPermissionMissing ?? false,
    activity: {
      synced: activity.synced,
      flow: activity.flow,
      weekly: activity.weekly,
      issuesUnavailable: activity.issuesUnavailable,
      ci: activity.actionsAvailable ? ciStats(activity.runRows, new Date(since + "T00:00:00Z")) : null,
      health: activity.healthRows[0] ?? null,
      /** Open issues and PRs, newest first */
      open: activity.issueRows
        .filter((i) => i.state === "open")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 8)
        .map((i) => ({ number: i.number, title: i.title, isPr: i.isPr, author: i.author, isBot: i.isBot, outside: isOutside(i), createdAt: i.createdAt })),
    },
    window14: windows[0] ?? null,
    referrerTrend,
    notes,
    alerts: repoAlerts,
    /** Notes + alerts inside the current window, for chart reference lines */
    markers: [
      ...notes.filter((n) => n.date >= since).map((n) => ({ date: n.date, label: n.label, kind: "note" as const })),
      ...repoAlerts.filter((a) => a.date >= since).map((a) => ({ date: a.date, label: alertShortLabel(a.kind), kind: "alert" as const })),
      ...repoReleases
        .filter((r) => isoDay(r.publishedAt) >= since)
        .map((r) => ({ date: isoDay(r.publishedAt), label: `🚀 ${r.tag}`, kind: "release" as const })),
    ],
    /** Published releases, newest first */
    releases: repoReleases.slice(0, 10).map((r) => ({ tag: r.tag, name: r.name, publishedAt: r.publishedAt, prerelease: r.prerelease, url: r.url })),
    /** This repo's alert overrides (null = global defaults) and the thresholds in effect */
    alertSettings: {
      override: override[0] ?? null,
      defaults: (({ spikeFactor, minViews, minClones, starBurst }) => ({ spikeFactor, minViews, minClones, starBurst }))(alertConfigFromEnv()),
      effective: effectiveConfig(alertConfigFromEnv(), override[0]),
    },
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
export async function getExportData(kind: "repos" | "daily", rangeDays: number, scope: Scope = ALL_SCOPE) {
  const db = getDb();
  if (kind === "repos") {
    const o = await getOverview(rangeDays, scope);
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
  const { since } = await windowFor(rangeDays, repoFilter(scope, trafficDaily.repoId));
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
    .where(and(gte(trafficDaily.date, since), repoFilter(scope, trafficDaily.repoId)))
    .orderBy(asc(trafficDaily.date), asc(repos.fullName));
}

/** Your own activity for /me: contribution totals, heatmap, streaks, repos, followers. Null before the first sync. */
export async function getMe(today = isoDay(), scope: Scope = ALL_SCOPE) {
  const db = getDb();
  if (scope.logins !== null && !scope.logins.length) return null;
  const [latest] = await db
    .select()
    .from(profileSnapshots)
    .where(scope.logins === null ? undefined : inArray(profileSnapshots.login, scope.logins))
    .orderBy(desc(profileSnapshots.date))
    .limit(1);
  if (!latest) return null;
  const login = latest.login;

  const [years, repoRows, days, followerRows] = await Promise.all([
    db.select().from(contributionYears).where(eq(contributionYears.login, login)).orderBy(asc(contributionYears.year)),
    db
      .select({ repo: contributionRepos.repo, commits: contributionRepos.commits, pullRequests: contributionRepos.pullRequests })
      .from(contributionRepos)
      .where(eq(contributionRepos.login, login)),
    db
      .select({ date: contributionDays.date, count: contributionDays.count })
      .from(contributionDays)
      .where(eq(contributionDays.login, login))
      .orderBy(asc(contributionDays.date)),
    db
      .select({ date: profileSnapshots.date, followers: profileSnapshots.followers, following: profileSnapshots.following })
      .from(profileSnapshots)
      .where(eq(profileSnapshots.login, login))
      .orderBy(asc(profileSnapshots.date)),
  ]);

  const sum = (k: "commits" | "pullRequests" | "issues" | "reviews" | "restricted" | "total") => years.reduce((a, y) => a + y[k], 0);
  const repos = aggregateContributedRepos(repoRows, login);
  const yearAgo = daysAgo(364, today);
  const monthAgo = followerRows.find((f) => f.date >= daysAgo(30, today)) ?? followerRows[0];

  return {
    login,
    since: years[0]?.year ?? null,
    totals: {
      commits: sum("commits"),
      pullRequests: sum("pullRequests"),
      issues: sum("issues"),
      reviews: sum("reviews"),
      restricted: sum("restricted"),
      total: sum("total"),
    },
    years: years.map((y) => ({
      year: y.year,
      commits: y.commits,
      pullRequests: y.pullRequests,
      issues: y.issues,
      reviews: y.reviews,
      total: y.total,
    })),
    lastYear: days.filter((d) => d.date >= yearAgo && d.date <= today).reduce((a, d) => a + d.count, 0),
    reposContributedTo: repos.length,
    topRepos: repos.slice(0, 10),
    streaks: contributionStreaks(days, today),
    heatmap: heatmapWeeks(days.filter((d) => d.date >= daysAgo(380, today)), today),
    followers: {
      current: latest.followers,
      following: latest.following,
      delta30: latest.followers - (monthAgo?.followers ?? latest.followers),
      history: followerRows,
    },
  };
}
