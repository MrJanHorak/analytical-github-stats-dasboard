import { unstable_cache } from "next/cache";
import { fetchCodeFrequency, fetchCommitActivity, fetchLanguages } from "./github";

/**
 * Cached wrappers for data the repo page fetches live from GitHub (not stored in the DB).
 * Keeps page loads fast and API usage low. Kept separate from github.ts so the CLI sync
 * script doesn't depend on Next.js.
 */
const HOUR = 60 * 60;

class NotReady extends Error {}

/**
 * Sign-in mode: read a repo with its own installation's token (other users' private repos are
 * invisible to anyone else's token). Single-user mode: the personal token, as before.
 */
async function asInstallation<T>(installationId: number | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!installationId) return fn();
  const [{ installationContext }, { withGitHub }] = await Promise.all([import("./github-app"), import("./github-context")]);
  return withGitHub(installationContext(installationId), fn);
}

const cachedLanguages = unstable_cache(
  (owner: string, repo: string, installationId: number | null) => asInstallation(installationId, () => fetchLanguages(owner, repo)),
  ["gh-languages"],
  { revalidate: 6 * HOUR },
);

const cachedCommitActivity = unstable_cache(
  async (owner: string, repo: string, installationId: number | null) => {
    const weeks = await asInstallation(installationId, () => fetchCommitActivity(owner, repo));
    // GitHub answers 202 (empty) while it computes stats — throw so the empty result isn't cached.
    if (!weeks.length) throw new NotReady();
    return weeks;
  },
  ["gh-commit-activity"],
  { revalidate: HOUR },
);

export async function getLanguages(owner: string, repo: string, installationId: number | null = null): Promise<Record<string, number>> {
  try {
    return await cachedLanguages(owner, repo, installationId);
  } catch {
    return {};
  }
}

export async function getCommitActivity(owner: string, repo: string, installationId: number | null = null) {
  try {
    return await cachedCommitActivity(owner, repo, installationId);
  } catch {
    return [];
  }
}

const cachedCodeFrequency = unstable_cache(
  async (owner: string, repo: string, installationId: number | null) => {
    try {
      const weeks = await asInstallation(installationId, () => fetchCodeFrequency(owner, repo));
      if (weeks === null) throw new NotReady(); // 202: still computing — don't cache
      return weeks;
    } catch (e) {
      // 422: GitHub doesn't compute this for repos with 10,000+ commits — cache the empty answer
      if ((e as { status?: unknown } | null)?.status === 422) return [];
      throw e;
    }
  },
  ["gh-code-frequency"],
  { revalidate: 6 * HOUR },
);

/** Weekly [week, additions, deletions] over the repo's history; [] while GitHub computes it or on failure. */
export async function getCodeFrequency(owner: string, repo: string, installationId: number | null = null): Promise<number[][]> {
  try {
    return await cachedCodeFrequency(owner, repo, installationId);
  } catch {
    return [];
  }
}

/** The GitHub App's slug, for "install" links (App mode). Rarely changes, so cached for a day. */
export const getAppSlug = unstable_cache(
  async () => {
    const { fetchAppSlug } = await import("./github-app");
    return fetchAppSlug();
  },
  ["gh-app-slug"],
  { revalidate: 24 * HOUR },
);

/** https://github.com/apps/<slug>/installations/new — install, or change which repos it can see. */
export async function installUrl(): Promise<string> {
  try {
    const slug = await getAppSlug();
    if (slug) return `https://github.com/apps/${slug}/installations/new`;
    console.error("install link: GitHub returned no App slug");
  } catch (err) {
    // Usually a wrong GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY; syncs will fail the same way.
    console.error("install link: could not authenticate as the GitHub App", err);
  }
  return "https://github.com/settings/installations";
}
