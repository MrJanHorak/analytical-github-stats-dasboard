// Fill the database with realistic fake data so you can preview the UI without a GitHub token.
//   npm run seed:demo        (uses DATABASE_URL; run `npm run db:push` or `npm run db:migrate` first)
// Re-running replaces previous demo data (repo ids 900001+).
import "dotenv/config";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../src/lib/db";
import { daysAgo, isoDay } from "../src/lib/utils";

const { alerts, annotations, contributionDays, contributionRepos, contributionYears, profileSnapshots, issues, workflowRuns, repoHealth, repoFrameworks, codeSnapshots, deployments, packageVersions, repos, repoLanguages, repoLoc, repoSnapshots, trafficDaily, trafficWindows, referrers, popularPaths, releaseAssets, starEvents, forkEvents, syncRuns } =
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
// Bytes per language and approximate lines, per demo repo (same order as DEMO)
const CODE: { languages: Record<string, number>; lines: number }[] = [
  { languages: { TypeScript: 412000, CSS: 38000, HTML: 4100 }, lines: 14800 },
  { languages: { TypeScript: 268000, CSS: 21000, JavaScript: 9000 }, lines: 9200 },
  { languages: { TypeScript: 151000, Python: 22000, CSS: 12000 }, lines: 6100 },
  { languages: { JavaScript: 54000, CSS: 14000, HTML: 6000 }, lines: 2300 },
  { languages: { TypeScript: 96000, CSS: 8000 }, lines: 3400 },
  { languages: { Shell: 18000, Lua: 4000 }, lines: 900 },
];
const REFERRERS = ["github.com", "google.com", "news.ycombinator.com", "reddit.com", "t.co", "dev.to", "linkedin.com"];
const DAYS = 120;

async function main() {
  const db = getDb();
  const ids = DEMO.map((_, i) => 900001 + i);
  for (const t of [alerts, annotations, issues, workflowRuns, repoHealth, repoFrameworks, codeSnapshots, deployments, repoLanguages, repoLoc, trafficDaily, trafficWindows, repoSnapshots, referrers, popularPaths, releaseAssets, starEvents, forkEvents]) {
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

    // GitHub's deduplicated 14-day totals: fewer uniques than the sum of daily uniques
    const last14 = traffic.slice(-14);
    const tot = (k: "views" | "viewUniques" | "clones" | "cloneUniques") => last14.reduce((a, d) => a + d[k], 0);
    await db.insert(trafficWindows).values({
      repoId: id,
      date: isoDay(),
      views: tot("views"),
      viewUniques: Math.round(tot("viewUniques") * 0.55),
      clones: tot("clones"),
      cloneUniques: Math.round(tot("cloneUniques") * 0.6),
    });

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

    // Referrers are a rolling 14-day snapshot stored once per sync — seed 30 days of history
    const refs = REFERRERS.slice(0, int(3, REFERRERS.length));
    for (let back = 29; back >= 0; back--) {
      const hn = i === 0 && back >= 16 && back <= 30 ? 3 : 1; // HN wave fading out of the 14-day window
      await db.insert(referrers).values(
        refs.map((r, k) => {
          const boost = r === "news.ycombinator.com" ? hn : 1;
          const count = Math.round(d.popularity * 14 * (0.5 / (k + 1)) * boost * (0.85 + rand() * 0.3));
          return { repoId: id, date: daysAgo(back), referrer: r, count, uniques: Math.round(count * 0.4) };
        }),
      );
    }
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

  // Languages + lines of code; dotfiles gets cloned by "CI" every day so it shows the likely-automated hint
  for (const [i, c] of CODE.entries()) {
    await db.insert(repoLanguages).values(Object.entries(c.languages).map(([language, bytes]) => ({ repoId: ids[i], language, bytes })));
    // Split the line count across languages roughly by bytes, like the tarball counter would report
    const totalBytes = Object.values(c.languages).reduce((a, b) => a + b, 0);
    const loc = Object.entries(c.languages).map(([language, bytes]) => {
      const nonBlank = Math.round((c.lines * bytes) / totalBytes);
      return { repoId: ids[i], language, files: Math.max(1, Math.round(nonBlank / 90)), lines: Math.round(nonBlank * 1.12), nonBlank };
    });
    await db.insert(repoLoc).values(loc);
    const linesOfCode = loc.reduce((a, l) => a + l.nonBlank, 0);
    await db.update(repos).set({ linesOfCode, codeStatsPushedAt: new Date(), locCommitSha: "demo" }).where(eq(repos.id, ids[i]));
  }
  await db
    .update(trafficDaily)
    .set({ clones: sql`4 + (extract(doy from ${trafficDaily.date})::int % 3)`, cloneUniques: 1 })
    .where(eq(trafficDaily.repoId, ids[5]));

  // Notes and alerts so the timeline, chart markers and alerts panel have something to show
  const top = ids[0];
  await db.insert(annotations).values([
    { repoId: top, date: daysAgo(31), label: "Posted on Hacker News" },
    { repoId: top, date: daysAgo(12), label: "v1.2.0 released" },
    { repoId: ids[1], date: daysAgo(20), label: "Blog post" },
  ]);
  await db.insert(alerts).values([
    { repoId: top, date: daysAgo(30), kind: "views_spike", value: 512, baseline: 61, message: `demo/${DEMO[0].name}: 512 views on ${daysAgo(30)} (8.4× the usual 61/day)` },
    { repoId: top, date: daysAgo(29), kind: "stars_burst", value: 23, message: `demo/${DEMO[0].name}: +23 stars on ${daysAgo(29)}` },
    { repoId: ids[1], date: daysAgo(6), kind: "stars_milestone_200", value: 200, message: `demo/${DEMO[1].name} reached 200 stars ⭐` },
  ]);

  // Frameworks & tools, as the line counter would detect them
  const FW: Record<string, [string, string, string | null][]> = {
    "balsa-glider-designer": [["React", "Frontend", "19.0.0"], ["Three.js", "Frontend", "0.170.0"], ["Next.js", "Full-stack", "15.1.0"], ["Tailwind CSS", "Styling & UI", "4.0.0"], ["Vitest", "Testing", "3.0.0"], ["TypeScript", "Build & tooling", "5.7.2"], ["Vercel", "Deployment", null], ["GitHub Actions", "Deployment", null]],
    terratime: [["React", "Frontend", "18.3.1"], ["Mapbox", "Frontend", "3.8.0"], ["Recharts", "Frontend", "2.13.0"], ["Vite", "Build & tooling", "6.0.3"], ["Tailwind CSS", "Styling & UI", "3.4.15"], ["TypeScript", "Build & tooling", "5.6.3"], ["Netlify", "Deployment", null], ["GitHub Actions", "Deployment", null]],
    "spot-on-shelves": [["React", "Frontend", "18.3.1"], ["Vite", "Build & tooling", "5.4.10"], ["Playwright", "Testing", "1.48.0"], ["Vitest", "Testing", "2.1.4"], ["TypeScript", "Build & tooling", "5.6.3"], ["GitHub Actions", "Deployment", null]],
    "pomodoro-timer": [["React", "Frontend", "18.2.0"], ["Vite", "Build & tooling", "4.5.0"], ["Jest", "Testing", "29.7.0"], ["Netlify", "Deployment", null]],
    "fire-pit-tool": [["Next.js", "Full-stack", "15.0.3"], ["React", "Frontend", "19.0.0"], ["Express", "Backend", "4.21.1"], ["Prisma", "Data & ORM", "5.22.0"], ["PostgreSQL", "Data & ORM", null], ["Tailwind CSS", "Styling & UI", "3.4.15"], ["TypeScript", "Build & tooling", "5.6.3"], ["Docker", "Deployment", null], ["Railway", "Deployment", null]],
    dotfiles: [],
  };
  // Packages the frameworks came from, and their latest releases, so some show as a major behind
  const PKG: Record<string, [string, string]> = {
    React: ["npm", "react"], "Next.js": ["npm", "next"], Vite: ["npm", "vite"], "Tailwind CSS": ["npm", "tailwindcss"],
    Vitest: ["npm", "vitest"], TypeScript: ["npm", "typescript"], Jest: ["npm", "jest"], Playwright: ["npm", "@playwright/test"],
    Express: ["npm", "express"], Prisma: ["npm", "prisma"], "Three.js": ["npm", "three"], Mapbox: ["npm", "mapbox-gl"], Recharts: ["npm", "recharts"],
  };
  const LATEST: Record<string, string> = {
    react: "19.2.0", next: "15.5.4", vite: "7.1.0", tailwindcss: "4.1.13", vitest: "3.2.4", typescript: "5.9.2", jest: "30.1.3",
    "@playwright/test": "1.55.0", express: "5.1.0", prisma: "6.16.0", three: "0.180.0", "mapbox-gl": "3.15.0", recharts: "3.2.0",
  };
  await db.delete(packageVersions);
  await db.insert(packageVersions).values(Object.entries(LATEST).map(([pkg, latest]) => ({ ecosystem: "npm", package: pkg, latest, checkedAt: new Date() })));
  for (const [i, d] of DEMO.entries()) {
    const rows = FW[d.name].map(([framework, category, version]) => ({
      repoId: ids[i],
      framework,
      category,
      version,
      package: version && PKG[framework] ? PKG[framework][1] : null,
      ecosystem: version && PKG[framework] ? PKG[framework][0] : null,
    }));
    if (rows.length) await db.insert(repoFrameworks).values(rows);
  }

  // Code history (one snapshot every few days, growing) plus test lines and TODOs
  const TEST_SHARE = [0.22, 0.12, 0.31, 0.05, 0.09, 0];
  for (const i of DEMO.keys()) {
    const c = CODE[i];
    const snaps: (typeof codeSnapshots.$inferInsert)[] = [];
    for (let back = DAYS - 1; back >= 0; back -= int(2, 6)) {
      const progress = 1 - back / DAYS;
      const lines = Math.round(c.lines * (0.72 + 0.28 * progress));
      snaps.push({ repoId: ids[i], date: daysAgo(back), linesOfCode: lines, testLines: Math.round(lines * TEST_SHARE[i] * (0.8 + 0.2 * progress)), todoCount: int(2, 30) });
    }
    snaps.push({ repoId: ids[i], date: daysAgo(0), linesOfCode: c.lines, testLines: Math.round(c.lines * TEST_SHARE[i]), todoCount: [14, 23, 6, 9, 31, 0][i] });
    await db.insert(codeSnapshots).values(snaps).onConflictDoNothing();
    const last = snaps.at(-1)!;
    await db.update(repos).set({ testLines: last.testLines, todoCount: last.todoCount }).where(eq(repos.id, ids[i]));
  }

  // Deployments for the repos that deploy to Vercel / Netlify / Railway
  const DEPLOYS: Record<string, [string, number]> = { "balsa-glider-designer": ["Vercel", 9], terratime: ["Netlify", 4], "pomodoro-timer": ["Netlify", 1], "fire-pit-tool": ["Railway", 3] };
  for (const [i, d] of DEMO.entries()) {
    const cfg = DEPLOYS[d.name];
    if (!cfg) continue;
    const rows: (typeof deployments.$inferInsert)[] = [];
    let id = ids[i] * 10_000;
    for (let back = 89; back >= 0; back--) {
      if (rand() > cfg[1] / 10) continue;
      const createdAt = new Date(daysAgo(back) + `T${String(int(9, 22)).padStart(2, "0")}:00:00Z`);
      const preview = rand() < 0.45;
      const roll = rand();
      rows.push({
        repoId: ids[i],
        deploymentId: id++,
        environment: preview ? "Preview" : "Production",
        production: !preview,
        ref: preview ? "feature-branch" : "main",
        creator: `${cfg[0].toLowerCase()}[bot]`,
        createdAt,
        state: roll < 0.9 ? "success" : roll < 0.96 ? "failure" : "inactive",
      });
    }
    if (rows.length) await db.insert(deployments).values(rows);
  }

  // Issues & PRs, Actions runs, community health and Dependabot alerts per repo
  const PEOPLE = ["mira-k", "tobias-dev", "lena.codes", "sam-ruiz", "okafor", "j-chen"];
  const HEALTH = [100, 85, 71, 57, 42, null]; // dotfiles: private → no community profile
  const DEPENDABOT = [[0, 1, 2, 0], [0, 0, 1, 3], [0, 0, 0, 0], [1, 2, 1, 0], [0, 0, 0, 1], null] as const;
  const at = (back: number, hour: number) => new Date(daysAgo(back) + `T${String(hour).padStart(2, "0")}:00:00Z`);
  for (const [i, d] of DEMO.entries()) {
    const repoId = ids[i];
    const items: (typeof issues.$inferInsert)[] = [];
    const count = Math.round(d.popularity / 2) + 4;
    for (let n = 1; n <= count; n++) {
      const back = int(1, DAYS);
      const isPr = rand() < 0.45;
      const bot = isPr && rand() < 0.2;
      const outside = !bot && rand() < Math.min(0.7, d.popularity / 60);
      const createdAt = at(back, int(8, 20));
      const closes = rand() < 0.75 && back > 1;
      const closedAt = closes ? new Date(createdAt.getTime() + int(1, Math.min(back, 12) * 24) * 3_600_000) : null;
      items.push({
        repoId,
        number: n,
        isPr,
        title: isPr ? (bot ? "Bump dependencies" : `Improve ${["docs", "tests", "export", "mobile layout", "charts"][n % 5]}`) : `${["Bug", "Question", "Feature request", "Crash"][n % 4]}: ${["wing preview", "CSV export", "dark mode", "sync", "units"][n % 5]}`,
        author: bot ? "dependabot[bot]" : outside ? PEOPLE[n % PEOPLE.length] : "demo",
        authorAssociation: bot ? "NONE" : outside ? (n % 3 ? "CONTRIBUTOR" : "NONE") : "OWNER",
        isBot: bot,
        state: closes ? "closed" : "open",
        createdAt,
        closedAt,
        mergedAt: isPr && closes && rand() < 0.85 ? closedAt : null,
      });
    }
    await db.insert(issues).values(items);

    if (i < 5) {
      const runs: (typeof workflowRuns.$inferInsert)[] = [];
      let id = repoId * 1000;
      for (let back = 90; back >= 0; back--) {
        const perDay = rand() < 0.6 ? int(1, Math.max(1, Math.round(d.popularity / 15))) : 0;
        for (let k = 0; k < perDay; k++) {
          const created = at(back, int(7, 22));
          const roll = rand();
          const conclusion = roll < 0.86 - i * 0.04 ? "success" : roll < 0.95 ? "failure" : "cancelled";
          runs.push({
            repoId,
            runId: id++,
            workflow: "CI",
            event: "push",
            branch: "main",
            status: "completed",
            conclusion,
            createdAt: created,
            startedAt: created,
            updatedAt: new Date(created.getTime() + int(60, 240 + i * 60) * 1000),
          });
        }
        if (back % 7 === 3) {
          const created = at(back, 12);
          runs.push({
            repoId,
            runId: id++,
            workflow: "Deploy",
            event: "workflow_dispatch",
            branch: "main",
            status: "completed",
            conclusion: rand() < 0.95 ? "success" : "failure",
            createdAt: created,
            startedAt: created,
            updatedAt: new Date(created.getTime() + int(30, 90) * 1000),
          });
        }
      }
      if (runs.length) await db.insert(workflowRuns).values(runs);
    }

    const h = HEALTH[i];
    const dep = DEPENDABOT[i];
    await db.insert(repoHealth).values({
      repoId,
      healthPercentage: h,
      hasDescription: h === null ? null : true,
      hasReadme: h === null ? null : true,
      hasLicense: h === null ? null : h >= 57,
      hasContributing: h === null ? null : h >= 71,
      hasCodeOfConduct: h === null ? null : h >= 85,
      hasIssueTemplate: h === null ? null : h >= 85,
      hasPrTemplate: h === null ? null : h >= 100,
      healthCheckedAt: new Date(),
      dependabotCritical: dep?.[0] ?? null,
      dependabotHigh: dep?.[1] ?? null,
      dependabotMedium: dep?.[2] ?? null,
      dependabotLow: dep?.[3] ?? null,
      actionsAvailable: true,
      deploymentsAvailable: true,
      issuesSyncedAt: new Date(),
      runsSyncedAt: new Date(),
      activitySyncedAt: new Date(),
    });
  }

  // Your activity (/me) for a "demo" account created three years ago
  for (const t of [contributionDays, contributionYears, contributionRepos, profileSnapshots]) await db.delete(t).where(eq(t.login, "demo"));
  const thisYear = new Date().getUTCFullYear();
  const days: { login: string; date: string; count: number }[] = [];
  for (let back = 0; isoDay(daysAgo(back)) >= `${thisYear - 3}-03-01`; back++) {
    const date = daysAgo(back);
    const weekday = new Date(date + "T00:00:00Z").getUTCDay() % 6 !== 0;
    // An 8-day current streak (8 days ago off), then a weekday-heavy pattern
    const busy = back <= 8 ? back < 8 : rand() < (weekday ? 0.78 : 0.35);
    days.push({ login: "demo", date, count: busy ? int(1, weekday ? 14 : 5) : 0 });
  }
  await db.insert(contributionDays).values(days);
  for (let year = thisYear - 3; year <= thisYear; year++) {
    const total = days.filter((d) => d.date.startsWith(`${year}-`)).reduce((a, d) => a + d.count, 0);
    const prs = Math.round(total * 0.08);
    const issues = Math.round(total * 0.05);
    const reviews = Math.round(total * 0.04);
    await db.insert(contributionYears).values({
      login: "demo",
      year,
      commits: total - prs - issues - reviews,
      pullRequests: prs,
      issues,
      reviews,
      reposWithCommits: 4 + (year - thisYear + 3) * 2,
      restricted: 0,
      total,
      syncedAt: new Date(),
    });
    const repoShare = [...DEMO.map((d) => `demo/${d.name}`), "vercel/next.js", "drizzle-team/drizzle-orm"];
    await db.insert(contributionRepos).values(
      repoShare.map((repo, k) => ({
        login: "demo",
        year,
        repo,
        commits: repo.startsWith("demo/") ? Math.round(((total - prs) * 0.9) / (k + 2)) : int(0, 6),
        pullRequests: repo.startsWith("demo/") ? int(0, 4) : int(1, 5),
      })),
    );
  }
  await db.insert(profileSnapshots).values(
    Array.from({ length: DAYS }, (_, k) => {
      const back = DAYS - 1 - k;
      return { login: "demo", date: daysAgo(back), followers: 140 + Math.round(k * 0.35) + (back < 31 ? 9 : 0), following: 61, publicRepos: DEMO.length };
    }),
  );

  await db.insert(syncRuns).values({ finishedAt: new Date(), reposSynced: DEMO.length });
  console.log(`Seeded ${DEMO.length} demo repos with ${DAYS} days of traffic.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
