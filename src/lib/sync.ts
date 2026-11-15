import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { fetchReleases, fetchTraffic, listOwnedRepos } from "./github";
import { isoDay, mapLimit } from "./utils";

const { repos, repoSnapshots, trafficDaily, referrers, popularPaths, releaseAssets, syncRuns } = schema;

const excluded = (col: string) => sql.raw(`excluded.${col}`);

type SyncResult = { reposSynced: number; errors: { repo: string; error: string }[] };

export async function runSync(): Promise<SyncResult> {
  const db = getDb();
  const today = isoDay();
  const [run] = await db.insert(syncRuns).values({}).returning({ id: syncRuns.id });

  const errors: SyncResult["errors"] = [];
  let reposSynced = 0;

  try {
    const owned = await listOwnedRepos();

    // 1. Repo metadata + daily snapshot of counters
    for (const r of owned) {
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

    // 2. Traffic + releases per repo (archived repos have no traffic API)
    const active = owned.filter((r) => !r.archived);
    await mapLimit(active, 4, async (r) => {
      try {
        await syncRepoTraffic(r.id, r.owner.login, r.name, today);
        reposSynced++;
      } catch (e) {
        errors.push({ repo: r.full_name, error: e instanceof Error ? e.message : String(e) });
      }
    });
  } catch (e) {
    errors.push({ repo: "*", error: e instanceof Error ? e.message : String(e) });
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

async function syncRepoTraffic(repoId: number, owner: string, name: string, today: string) {
  const db = getDb();
  const t = await fetchTraffic(owner, name);

  // Merge views + clones into one row per day
  const days = new Map<string, { views: number; viewUniques: number; clones: number; cloneUniques: number }>();
  const row = (d: string) => {
    if (!days.has(d)) days.set(d, { views: 0, viewUniques: 0, clones: 0, cloneUniques: 0 });
    return days.get(d)!;
  };
  for (const v of t.views ?? []) Object.assign(row(isoDay(v.timestamp)), { views: v.count, viewUniques: v.uniques });
  for (const c of t.clones ?? []) Object.assign(row(isoDay(c.timestamp)), { clones: c.count, cloneUniques: c.uniques });

  if (days.size) {
    await db
      .insert(trafficDaily)
      .values([...days].map(([date, v]) => ({ repoId, date, ...v })))
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
