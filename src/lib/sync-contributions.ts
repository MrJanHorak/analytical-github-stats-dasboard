import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { fetchContributions, fetchViewer } from "./github";
import { isoDay } from "./utils";

const { contributionDays, contributionYears, contributionRepos, profileSnapshots } = schema;
const excluded = (col: string) => sql.raw(`excluded.${col}`);

/** Which calendar years still need fetching: never stored, or not synced since the year ended. */
export function yearsToFetch(createdAt: Date, now: Date, syncedAt: Map<number, Date>): number[] {
  const out: number[] = [];
  for (let y = now.getUTCFullYear(); y >= createdAt.getUTCFullYear(); y--) {
    const at = syncedAt.get(y);
    // A day of slack: GitHub's calendar follows the user's time zone, so 1 Jan UTC can still be "last year".
    if (!at || at.getTime() < Date.UTC(y + 1, 0, 2)) out.push(y);
  }
  return out; // newest first, so the current year is always fresh even when the budget runs out
}

/**
 * Store the token user's contributions and follower counts. The first run backfills every year
 * back to account creation (one GraphQL query per year); after that only the current year (and
 * last year, until it has been synced once after it ended) is refetched.
 */
export async function syncContributions(opts: { now?: Date; outOfTime?: () => boolean } = {}) {
  const db = getDb();
  const now = opts.now ?? new Date();
  const viewer = await fetchViewer();
  const login = viewer.login;

  await db
    .insert(profileSnapshots)
    .values({ login, date: isoDay(now), followers: viewer.followers, following: viewer.following, publicRepos: viewer.publicRepos })
    .onConflictDoUpdate({
      target: [profileSnapshots.login, profileSnapshots.date],
      set: { followers: excluded("followers"), following: excluded("following"), publicRepos: excluded("public_repos") },
    });

  const stored = await db
    .select({ year: contributionYears.year, syncedAt: contributionYears.syncedAt })
    .from(contributionYears)
    .where(eq(contributionYears.login, login));
  const years = yearsToFetch(new Date(viewer.createdAt), now, new Map(stored.map((s) => [s.year, s.syncedAt])));

  let fetched = 0;
  for (const year of years) {
    if (opts.outOfTime?.()) break;
    const from = new Date(Math.max(Date.UTC(year, 0, 1), new Date(viewer.createdAt).getTime()));
    const to = new Date(Math.min(Date.UTC(year, 11, 31, 23, 59, 59), now.getTime()));
    const c = await fetchContributions(from, to);

    const days = c.days.filter((d) => d.date.startsWith(`${year}-`)).map((d) => ({ login, date: d.date, count: d.count }));
    if (days.length)
      await db
        .insert(contributionDays)
        .values(days)
        .onConflictDoUpdate({ target: [contributionDays.login, contributionDays.date], set: { count: excluded("count") } });

    await db.delete(contributionRepos).where(and(eq(contributionRepos.login, login), eq(contributionRepos.year, year)));
    if (c.repos.length) await db.insert(contributionRepos).values(c.repos.map((r) => ({ login, year, ...r })));

    const row = {
      login,
      year,
      commits: c.commits,
      pullRequests: c.pullRequests,
      issues: c.issues,
      reviews: c.reviews,
      reposWithCommits: c.reposWithCommits,
      restricted: c.restricted,
      total: c.total,
      syncedAt: now,
    };
    await db
      .insert(contributionYears)
      .values(row)
      .onConflictDoUpdate({
        target: [contributionYears.login, contributionYears.year],
        set: {
          commits: excluded("commits"),
          pullRequests: excluded("pull_requests"),
          issues: excluded("issues"),
          reviews: excluded("reviews"),
          reposWithCommits: excluded("repos_with_commits"),
          restricted: excluded("restricted"),
          total: excluded("total"),
          syncedAt: excluded("synced_at"),
        },
      });
    fetched++;
  }
  return { login, yearsFetched: fetched, yearsPending: years.length - fetched };
}
