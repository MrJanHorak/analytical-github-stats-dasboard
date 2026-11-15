import { unstable_cache } from "next/cache";
import { fetchCommitActivity, fetchLanguages } from "./github";

/**
 * Cached wrappers for data the repo page fetches live from GitHub (not stored in the DB).
 * Keeps page loads fast and API usage low. Kept separate from github.ts so the CLI sync
 * script doesn't depend on Next.js.
 */
const HOUR = 60 * 60;

class NotReady extends Error {}

const cachedLanguages = unstable_cache((owner: string, repo: string) => fetchLanguages(owner, repo), ["gh-languages"], {
  revalidate: 6 * HOUR,
});

const cachedCommitActivity = unstable_cache(
  async (owner: string, repo: string) => {
    const weeks = await fetchCommitActivity(owner, repo);
    // GitHub answers 202 (empty) while it computes stats — throw so the empty result isn't cached.
    if (!weeks.length) throw new NotReady();
    return weeks;
  },
  ["gh-commit-activity"],
  { revalidate: HOUR },
);

export async function getLanguages(owner: string, repo: string): Promise<Record<string, number>> {
  try {
    return await cachedLanguages(owner, repo);
  } catch {
    return {};
  }
}

export async function getCommitActivity(owner: string, repo: string) {
  try {
    return await cachedCommitActivity(owner, repo);
  } catch {
    return [];
  }
}
