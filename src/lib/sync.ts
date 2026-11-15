import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { fetchForks, fetchReleases, fetchStargazers, fetchTraffic, listOwnedRepos } from "./github";
import { mergeTraffic } from "./transform";
import { isoDay, mapLimit } from "./utils";

const {
  repos,
  repoSnapshots,
  trafficDaily,
  referrers,
  popularPaths,
  releaseAssets,
  starEvents,
  forkEvents,
  syncRuns,
} = schema;

const excluded = (col: string) => sql.raw(`excluded.${col}`);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type SyncResult = { reposSynced: number; errors: { repo: string; error: string }[] };

type OwnedRepo = Awaited<ReturnType<typeof listOwnedRepos>>[number];

export async function runSync(): Promise<SyncResult> {
  const db = getDb();
  const today = isoDay();
  const [run] = await db.insert(syncRuns).values({}).returning({ id: syncRuns.id });

  const errors: SyncResult["errors"] = [];
  let reposSynced = 0;

  try {
    const owned = await listOwnedRepos();
    const [starCounts, forkCounts] = await Promise.all([countBy(starEvents), countBy(forkEvents)]);

    for (const r of owned) await upsertRepoAndSnapshot(r, today);

    await mapLimit(owned, 4, async (r) => {
      const owner = r.owner.login;
      try {
        // Archived repos are read-only: GitHub returns 403 for their traffic endpoints.
        if (!r.archived) await syncRepoTraffic(r.id, owner, r.name, today);
        // Only refetch stargazers/forks when the count moved — keeps API usage low.
        if ((starCounts.get(r.id) ?? 0) !== (r.stargazers_count ?? 0)) await syncStars(r.id, owner, r.name);
        if ((forkCounts.get(r.id) ?? 0) !== (r.forks_count ?? 0)) await syncForks(r.id, owner, r.name);
        reposSynced++;
      } catch (e) {
        errors.push({ repo: r.full_name, error: errMsg(e) });
      }
    });
  } catch (e) {
    errors.push({ repo: "*", error: errMsg(e) });
  }

  await db
    .update(syncRuns)
    .set({
      finishedAt: new Date(),
      reposSynced,
      error: errors.length ? JSON.stringify(errors).slice(0, 4000) : null,
    })
    .where(eq(syncRuns.id, run.id));

  return { reposSynced, errors };
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
