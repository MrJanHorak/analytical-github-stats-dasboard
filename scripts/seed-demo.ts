// Fill the database with realistic fake data so you can preview the UI without a GitHub token.
//   npm run seed:demo        (uses DATABASE_URL; run `npm run db:push` or `npm run db:migrate` first)
// Re-running replaces previous demo data (repo ids 900001+).
import "dotenv/config";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "../src/lib/db";
import { daysAgo, isoDay } from "../src/lib/utils";

const { repos, repoSnapshots, trafficDaily, referrers, popularPaths, releaseAssets, starEvents, forkEvents, syncRuns } =
  schema;

// Deterministic PRNG so screenshots are stable
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const int = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

const DEMO = [
  { name: "balsa-glider-designer", lang: "TypeScript", popularity: 60, created: "2024-03-10" },
  { name: "terratime", lang: "TypeScript", popularity: 35, created: "2023-11-02" },
  { name: "spot-on-shelves", lang: "TypeScript", popularity: 18, created: "2024-08-21" },
  { name: "pomodoro-timer", lang: "JavaScript", popularity: 9, created: "2022-05-14" },
  { name: "fire-pit-tool", lang: "TypeScript", popularity: 6, created: "2025-02-01" },
  { name: "dotfiles", lang: "Shell", popularity: 2, created: "2021-09-30" },
];
const REFERRERS = ["github.com", "google.com", "news.ycombinator.com", "reddit.com", "t.co", "dev.to", "linkedin.com"];
const DAYS = 120;

async function main() {
  const db = getDb();
  const ids = DEMO.map((_, i) => 900001 + i);
  for (const t of [trafficDaily, repoSnapshots, referrers, popularPaths, releaseAssets, starEvents, forkEvents]) {
    await db.delete(t).where(inArray(t.repoId, ids));
  }
  await db.delete(repos).where(inArray(repos.id, ids));

  for (const [i, d] of DEMO.entries()) {
    const id = ids[i];
    const full = `demo/${d.name}`;
    const starCount = d.popularity * int(3, 6);
    const forkCount = Math.round(starCount / int(5, 9));

    // Stars: spread from creation, with a spike ~30 days ago for the top repo (e.g. a HN post)
    const created = new Date(d.created + "T00:00:00Z").getTime();
    const now = Date.now();
    const stars = Array.from({ length: starCount }, (_, k) => {
      const spike = i === 0 && k % 3 === 0;
      const t = spike ? now - int(28, 32) * 864e5 : created + rand() ** 0.6 * (now - created);
      return { repoId: id, login: `stargazer-${id}-${k}`, starredAt: new Date(t) };
    });
    const forks = Array.from({ length: forkCount }, (_, k) => ({
      repoId: id,
      forkId: id * 1000 + k,
      owner: `forker${k}`,
      fullName: `forker${k}/${d.name}`,
      stars: int(0, 3),
      createdAt: new Date(created + rand() * (now - created)),
    }));

    await db.insert(repos).values({
      id,
      owner: "demo",
      name: d.name,
      fullName: full,
      description: `Demo data for ${d.name}`,
      isPrivate: i === 5,
      language: d.lang,
      htmlUrl: `https://github.com/${full}`,
      createdAt: new Date(created),
      pushedAt: new Date(now - int(0, 40) * 864e5),
      syncedAt: new Date(),
    });
    if (stars.length) await db.insert(starEvents).values(stars);
    if (forks.length) await db.insert(forkEvents).values(forks);

    const traffic = Array.from({ length: DAYS }, (_, k) => {
      const back = DAYS - 1 - k;
      const weekday = new Date(daysAgo(back)).getUTCDay();
      const weekend = weekday === 0 || weekday === 6 ? 0.6 : 1;
      const spike = i === 0 && back >= 28 && back <= 32 ? 6 : 1;
      const views = Math.round(d.popularity * weekend * spike * (0.6 + rand()));
      return {
        repoId: id,
        date: daysAgo(back),
        views,
        viewUniques: Math.round(views * (0.3 + rand() * 0.2)),
        clones: Math.round(views * rand() * 0.15),
        cloneUniques: Math.round(views * rand() * 0.08),
      };
    });
    await db.insert(trafficDaily).values(traffic);

    for (let back = DAYS - 1; back >= 0; back -= 7) {
      const date = daysAgo(back);
      const cutoff = new Date(date + "T23:59:59Z");
      await db.insert(repoSnapshots).values({
        repoId: id,
        date,
        stars: stars.filter((s) => s.starredAt <= cutoff).length,
        forks: forks.filter((f) => f.createdAt <= cutoff).length,
        watchers: int(1, 10),
        openIssues: int(0, 12),
        sizeKb: int(200, 9000),
      });
    }
    await db.insert(repoSnapshots).values({
      repoId: id,
      date: isoDay(),
      stars: stars.length,
      forks: forks.length,
      watchers: int(1, 10),
      openIssues: int(0, 12),
      sizeKb: int(200, 9000),
    }).onConflictDoNothing();

    const refs = REFERRERS.slice(0, int(3, REFERRERS.length));
    await db.insert(referrers).values(
      refs.map((r, k) => {
        const count = Math.round(d.popularity * 14 * (0.5 / (k + 1)) * (0.7 + rand()));
        return { repoId: id, date: isoDay(), referrer: r, count, uniques: Math.round(count * 0.4) };
      }),
    );
    const paths = ["", "/blob/main/README.md", "/issues", "/releases", "/tree/main/src", "/pulls"];
    await db.insert(popularPaths).values(
      paths.map((p, k) => {
        const count = Math.round(d.popularity * 14 * (0.6 / (k + 1)) * (0.7 + rand()));
        return { repoId: id, date: isoDay(), path: `/${full}${p}`, title: `${d.name}${p}`, count, uniques: Math.round(count * 0.45) };
      }),
    );
    if (i < 3) {
      for (let back = 56; back >= 0; back -= 7) {
        await db.insert(releaseAssets).values([
          { repoId: id, date: daysAgo(back), assetId: id * 10 + 1, releaseTag: "v1.2.0", assetName: `${d.name}-macos.zip`, downloads: d.popularity * 3 + (56 - back) * int(1, 4) },
          { repoId: id, date: daysAgo(back), assetId: id * 10 + 2, releaseTag: "v1.2.0", assetName: `${d.name}-win.zip`, downloads: d.popularity * 2 + (56 - back) * int(1, 3) },
        ]);
      }
    }
  }

  await db.insert(syncRuns).values({ finishedAt: new Date(), reposSynced: DEMO.length });
  console.log(`Seeded ${DEMO.length} demo repos with ${DAYS} days of traffic.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
