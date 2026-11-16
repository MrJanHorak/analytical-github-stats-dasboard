import { eq, sql } from "drizzle-orm";
import { evaluateAlerts, notifyAlerts } from "./alerts";
import { getDb, schema } from "./db";
import {
  fetchBranchSha,
  fetchForks,
  fetchLanguages,
  fetchReleases,
  fetchStargazers,
  fetchTarball,
  fetchTraffic,
  listOwnedRepos,
} from "./github";
import { countTarball } from "./loc";
import { activityMarkers, syncRepoActivity } from "./sync-activity";
import { syncContributions } from "./sync-contributions";
import { mergeTraffic } from "./transform";
import { isoDay, mapLimit } from "./utils";

const {
  repos,
  repoLanguages,
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
} = schema;

const excluded = (col: string) => sql.raw(`excluded.${col}`);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isForbidden = (e: unknown) => (e as { status?: unknown } | null)?.status === 403;

export type SyncResult = {
  /** Repos whose traffic/releases were collected this run */
  reposSynced: number;
  /** Star/fork history refreshes left for the next run because the time budget ran out */
  historyPending: number;
  /** Repos whose languages / lines of code still need (re)computing next run (time budget ran out) */
  codeStatsPending: number;
  /** Repos whose issues / Actions runs / health weren't refreshed this run (time budget ran out) */
  activityPending: number;
  /** Years of your contribution history still to backfill (time budget); null if it couldn't be fetched */
  contributionYearsPending: number | null;
  /** New alerts recorded this run (spikes, star bursts, milestones) */
  alertsCreated: number;
  /**
   * Repos whose stargazer list GitHub refused (403) — it is restricting that endpoint to
   * admins/collaborators. Star counts still update; only the star-history backfill is skipped.
   */
  starHistoryUnavailable: string[];
  errors: { repo: string; error: string }[];
};

export type SyncOptions = {
  /**
   * Stop starting new star/fork history refreshes after this many ms.
   * Traffic (which expires after 14 days) is always collected first and in full.
   * Leftover history work is picked up automatically on the next run.
   */
  timeBudgetMs?: number;
};

/** Repos bigger than this (GitHub's size, in KB) are not downloaded for line counting. */
export const MAX_LOC_REPO_KB = 500 * 1024;

type OwnedRepo = Awaited<ReturnType<typeof listOwnedRepos>>[number];
type HistoryJob = { repo: OwnedRepo; kind: "stars" | "forks"; size: number };

export async function runSync(opts: SyncOptions = {}): Promise<SyncResult> {
  const db = getDb();
  const started = Date.now();
  const outOfTime = () => opts.timeBudgetMs !== undefined && Date.now() - started > opts.timeBudgetMs;
  const today = isoDay();
  const [run] = await db.insert(syncRuns).values({}).returning({ id: syncRuns.id });

  const errors: SyncResult["errors"] = [];
  let reposSynced = 0;
  let historyPending = 0;
  const starHistoryUnavailable: string[] = [];
  let codeStatsPending = 0;
  let contributionYearsPending: number | null = null;
  let activityPending = 0;

  try {
    const owned = await listOwnedRepos();
    const [starCounts, forkCounts, codeStatsFor, activityFor] = await Promise.all([
      countBy(starEvents),
      countBy(forkEvents),
      codeStatsMarkers(),
      activityMarkers(),
    ]);

    for (const r of owned) await upsertRepoAndSnapshot(r, today);

    // Phase 1 — traffic: time-critical, GitHub discards it after 14 days.
    // Archived repos are read-only: GitHub returns 403 for their traffic endpoints.
    await mapLimit(
      owned.filter((r) => !r.archived),
      4,
      async (r) => {
        try {
          await syncRepoTraffic(r.id, r.owner.login, r.name, today);
          reposSynced++;
        } catch (e) {
          errors.push({ repo: r.full_name, error: errMsg(e) });
        }
      },
    );

    // Phase 1b — your own contributions + followers (cheap after the one-time backfill).
    try {
      contributionYearsPending = (await syncContributions({ outOfTime })).yearsPending;
    } catch (e) {
      errors.push({ repo: "contributions", error: errMsg(e) });
    }

    // Phase 2 — star/fork history: only for repos whose count moved (keeps API usage low).
    // Smallest first, so a big first-time backfill can't starve everything else.
    const jobs: HistoryJob[] = [];
    for (const r of owned) {
      if ((starCounts.get(r.id) ?? 0) !== (r.stargazers_count ?? 0))
        jobs.push({ repo: r, kind: "stars", size: r.stargazers_count ?? 0 });
      if ((forkCounts.get(r.id) ?? 0) !== (r.forks_count ?? 0))
        jobs.push({ repo: r, kind: "forks", size: r.forks_count ?? 0 });
    }
    jobs.sort((a, b) => a.size - b.size);

    await mapLimit(jobs, 4, async ({ repo: r, kind }) => {
      if (outOfTime()) {
        historyPending++;
        return;
      }
      try {
        if (kind === "stars") await syncStars(r.id, r.owner.login, r.name);
        else await syncForks(r.id, r.owner.login, r.name);
      } catch (e) {
        if (kind === "stars" && isForbidden(e)) starHistoryUnavailable.push(r.full_name);
        else errors.push({ repo: `${r.full_name} (${kind})`, error: errMsg(e) });
      }
    });

    // Phase 3 — languages + lines of code: only for repos pushed since they were last checked.
    // Counting downloads a tarball, so it is done two at a time and stops when the budget runs out.
    const codeJobs = owned.filter((r) => r.pushed_at && codeStatsFor.get(r.id)?.at !== new Date(r.pushed_at).getTime());
    await mapLimit(codeJobs, 2, async (r) => {
      if (outOfTime()) return void codeStatsPending++;
      try {
        await syncCodeStats(r, codeStatsFor.get(r.id)?.sha ?? null);
      } catch (e) {
        errors.push({ repo: `${r.full_name} (code stats)`, error: errMsg(e) });
      }
    });

    // Phase 4 — issues & PRs, Actions runs, Dependabot alerts, community health (incremental,
    // ~3 requests per repo per day). Your own active repos only; least recently synced first.
    const activityJobs = owned
      .filter((r) => !r.fork && !r.archived)
      .sort((a, b) => (activityFor.get(a.id)?.activitySyncedAt?.getTime() ?? 0) - (activityFor.get(b.id)?.activitySyncedAt?.getTime() ?? 0));
    await mapLimit(activityJobs, 4, async (r) => {
      if (outOfTime()) return void activityPending++;
      try {
        await syncRepoActivity(r, activityFor.get(r.id));
      } catch (e) {
        errors.push({ repo: `${r.full_name} (activity)`, error: errMsg(e) });
      }
    });
  } catch (e) {
    errors.push({ repo: "*", error: errMsg(e) });
  }

  // Alerts: judge yesterday against the stored history, then notify (both best-effort)
  let alertsCreated = 0;
  try {
    alertsCreated = (await evaluateAlerts()).length;
    await notifyAlerts();
  } catch (e) {
    errors.push({ repo: "alerts", error: errMsg(e) });
  }

  await db
    .update(syncRuns)
    .set({
      finishedAt: new Date(),
      reposSynced,
      error: errors.length ? JSON.stringify(errors).slice(0, 4000) : null,
    })
    .where(eq(syncRuns.id, run.id));

  return { reposSynced, historyPending, codeStatsPending, activityPending, contributionYearsPending, alertsCreated, starHistoryUnavailable, errors };
}

/** repo id → pushed_at (ms) that languages/lines were last checked for, and the commit that was counted */
async function codeStatsMarkers() {
  const rows = await getDb()
    .select({ id: repos.id, at: repos.codeStatsPushedAt, sha: repos.locCommitSha })
    .from(repos)
    .where(sql`${repos.codeStatsPushedAt} is not null`);
  return new Map(rows.map((r) => [r.id, { at: r.at!.getTime(), sha: r.sha }]));
}

/**
 * Store languages and lines of code. Lines are recounted from the default branch's tarball only
 * when its latest commit differs from the one last counted (a push to another branch is cheap).
 */
async function syncCodeStats(r: OwnedRepo, countedSha: string | null) {
  const db = getDb();
  const owner = r.owner.login;
  const languages = await fetchLanguages(owner, r.name);
  await db.delete(repoLanguages).where(eq(repoLanguages.repoId, r.id));
  const langRows = Object.entries(languages ?? {}).map(([language, bytes]) => ({ repoId: r.id, language, bytes }));
  if (langRows.length) await db.insert(repoLanguages).values(langRows).onConflictDoNothing();

  const markDone = (set: Partial<typeof repos.$inferInsert> = {}) =>
    db
      .update(repos)
      .set({ ...set, codeStatsPushedAt: new Date(r.pushed_at!) })
      .where(eq(repos.id, r.id));

  if ((r.size ?? 0) > MAX_LOC_REPO_KB) {
    await db.delete(repoLoc).where(eq(repoLoc.repoId, r.id));
    return markDone({ linesOfCode: null, locCommitSha: null });
  }
  const sha = await fetchBranchSha(owner, r.name, r.default_branch);
  if (sha && sha === countedSha) return markDone();

  const summary = sha ? await countTarball(await fetchTarball(owner, r.name, sha)) : null;
  await db.delete(repoLoc).where(eq(repoLoc.repoId, r.id));
  const locRows = (summary?.languages ?? []).map((l) => ({ repoId: r.id, ...l }));
  if (locRows.length) await db.insert(repoLoc).values(locRows).onConflictDoNothing();
  return markDone({ linesOfCode: summary?.nonBlank ?? 0, locCommitSha: sha });
}

async function countBy(table: typeof starEvents | typeof forkEvents) {
  const rows = await getDb()
    .select({ repoId: table.repoId, n: sql<number>`count(*)::int` })
    .from(table)
    .groupBy(table.repoId);
  return new Map(rows.map((r) => [r.repoId, r.n]));
}

async function upsertRepoAndSnapshot(r: OwnedRepo, today: string) {
  const db = getDb();
  await db
    .insert(repos)
    .values({
      id: r.id,
      owner: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      isPrivate: r.private,
      isFork: r.fork,
      isArchived: r.archived ?? false,
      language: r.language ?? null,
      htmlUrl: r.html_url,
      createdAt: r.created_at ? new Date(r.created_at) : null,
      pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: repos.id,
      set: {
        owner: excluded("owner"),
        name: excluded("name"),
        fullName: excluded("full_name"),
        description: excluded("description"),
        isPrivate: excluded("private"),
        isFork: excluded("fork"),
        isArchived: excluded("archived"),
        language: excluded("language"),
        htmlUrl: excluded("html_url"),
        pushedAt: excluded("pushed_at"),
        syncedAt: excluded("synced_at"),
      },
    });

  await db
    .insert(repoSnapshots)
    .values({
      repoId: r.id,
      date: today,
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      watchers: r.watchers_count ?? 0,
      openIssues: r.open_issues_count ?? 0,
      sizeKb: r.size ?? 0,
    })
    .onConflictDoUpdate({
      target: [repoSnapshots.repoId, repoSnapshots.date],
      set: {
        stars: excluded("stars"),
        forks: excluded("forks"),
        watchers: excluded("watchers"),
        openIssues: excluded("open_issues"),
        sizeKb: excluded("size_kb"),
      },
    });
}

async function syncRepoTraffic(repoId: number, owner: string, name: string, today: string) {
  const db = getDb();
  const t = await fetchTraffic(owner, name);

  await db
    .insert(trafficWindows)
    .values({ repoId, date: today, ...t.window })
    .onConflictDoUpdate({
      target: [trafficWindows.repoId, trafficWindows.date],
      set: {
        views: excluded("views"),
        viewUniques: excluded("view_uniques"),
        clones: excluded("clones"),
        cloneUniques: excluded("clone_uniques"),
      },
    });

  const days = mergeTraffic(t.views, t.clones);
  if (days.length) {
    await db
      .insert(trafficDaily)
      .values(days.map((d) => ({ repoId, ...d })))
      .onConflictDoUpdate({
        target: [trafficDaily.repoId, trafficDaily.date],
        set: {
          views: excluded("views"),
          viewUniques: excluded("view_uniques"),
          clones: excluded("clones"),
          cloneUniques: excluded("clone_uniques"),
        },
      });
  }

  if (t.referrers.length) {
    await db
      .insert(referrers)
      .values(t.referrers.map((r) => ({ repoId, date: today, referrer: r.referrer, count: r.count, uniques: r.uniques })))
      .onConflictDoUpdate({
        target: [referrers.repoId, referrers.date, referrers.referrer],
        set: { count: excluded("count"), uniques: excluded("uniques") },
      });
  }

  if (t.paths.length) {
    await db
      .insert(popularPaths)
      .values(t.paths.map((p) => ({ repoId, date: today, path: p.path, title: p.title, count: p.count, uniques: p.uniques })))
      .onConflictDoUpdate({
        target: [popularPaths.repoId, popularPaths.date, popularPaths.path],
        set: { title: excluded("title"), count: excluded("count"), uniques: excluded("uniques") },
      });
  }

  const releases = await fetchReleases(owner, name);
  const assets = releases.flatMap((rel) =>
    rel.assets.map((a) => ({
      repoId,
      date: today,
      assetId: a.id,
      releaseTag: rel.tag_name,
      assetName: a.name,
      downloads: a.download_count,
    })),
  );
  if (assets.length) {
    await db
      .insert(releaseAssets)
      .values(assets)
      .onConflictDoUpdate({
        target: [releaseAssets.repoId, releaseAssets.date, releaseAssets.assetId],
        set: { downloads: excluded("downloads") },
      });
  }
}

/** Replace the stored stargazer list (handles un-stars too). */
async function syncStars(repoId: number, owner: string, name: string) {
  const db = getDb();
  const stars = await fetchStargazers(owner, name);
  await db.delete(starEvents).where(eq(starEvents.repoId, repoId));
  for (const chunk of chunks(stars, 500)) {
    await db
      .insert(starEvents)
      .values(chunk.map((s) => ({ repoId, login: s.login, starredAt: new Date(s.starredAt) })))
      .onConflictDoNothing();
  }
}

/** Replace the stored fork list (handles deleted forks too). */
async function syncForks(repoId: number, owner: string, name: string) {
  const db = getDb();
  const forks = await fetchForks(owner, name);
  await db.delete(forkEvents).where(eq(forkEvents.repoId, repoId));
  for (const chunk of chunks(forks, 500)) {
    await db
      .insert(forkEvents)
      .values(chunk.map((f) => ({ repoId, ...f, createdAt: new Date(f.createdAt) })))
      .onConflictDoNothing();
  }
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
