import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Octokit } from "@octokit/rest";

let _octokit: Octokit | null = null;

export function getOctokit() {
  if (!_octokit) {
    const auth = process.env.GITHUB_TOKEN;
    if (!auth) throw new Error("GITHUB_TOKEN is not set");
    _octokit = new Octokit({ auth, userAgent: "github-repo-stats" });
  }
  return _octokit;
}

/** All repositories owned by the token's user. */
export async function listOwnedRepos() {
  const octokit = getOctokit();
  return octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    affiliation: "owner",
    per_page: 100,
  });
}

export async function fetchTraffic(owner: string, repo: string) {
  const octokit = getOctokit();
  const [views, clones, refs, paths] = await Promise.all([
    octokit.rest.repos.getViews({ owner, repo, per: "day" }),
    octokit.rest.repos.getClones({ owner, repo, per: "day" }),
    octokit.rest.repos.getTopReferrers({ owner, repo }),
    octokit.rest.repos.getTopPaths({ owner, repo }),
  ]);
  return {
    window: {
      views: views.data.count,
      viewUniques: views.data.uniques,
      clones: clones.data.count,
      cloneUniques: clones.data.uniques,
    },
    views: views.data.views,
    clones: clones.data.clones,
    referrers: refs.data,
    paths: paths.data,
  };
}

export async function fetchReleases(owner: string, repo: string) {
  const octokit = getOctokit();
  return octokit.paginate(octokit.rest.repos.listReleases, { owner, repo, per_page: 100 });
}

/** All stargazers with the time they starred (needs the star+json media type). */
export async function fetchStargazers(owner: string, repo: string) {
  const octokit = getOctokit();
  const rows = await octokit.paginate(octokit.rest.activity.listStargazersForRepo, {
    owner,
    repo,
    per_page: 100,
    headers: { accept: "application/vnd.github.star+json" },
  });
  return (rows as unknown as { starred_at?: string; user?: { login: string } | null }[])
    .filter((s) => s.starred_at && s.user?.login)
    .map((s) => ({ login: s.user!.login, starredAt: s.starred_at! }));
}

export async function fetchForks(owner: string, repo: string) {
  const octokit = getOctokit();
  const forks = await octokit.paginate(octokit.rest.repos.listForks, { owner, repo, per_page: 100, sort: "oldest" });
  return forks.map((f) => ({
    forkId: f.id,
    fullName: f.full_name,
    owner: f.owner.login,
    stars: f.stargazers_count ?? 0,
    createdAt: f.created_at ?? new Date().toISOString(),
  }));
}

export async function fetchLanguages(owner: string, repo: string) {
  const { data } = await getOctokit().rest.repos.listLanguages({ owner, repo });
  return data;
}

/**
 * Weekly [week, additions, deletions] over the repo's whole history (deletions are negative).
 * Returns null while GitHub is still computing (202) and [] for an empty repo (204).
 * GitHub answers 422 for repos with 10,000+ commits — that error is left to the caller.
 */
export async function fetchCodeFrequency(owner: string, repo: string): Promise<number[][] | null> {
  const res = await getOctokit().rest.repos.getCodeFrequencyStats({ owner, repo });
  if ((res.status as number) === 202) return null;
  return Array.isArray(res.data) ? res.data : [];
}

/** Latest commit on a branch, or null for an empty repository (GitHub answers 404/409). */
export async function fetchBranchSha(owner: string, repo: string, branch: string): Promise<string | null> {
  try {
    const { data } = await getOctokit().rest.repos.getBranch({ owner, repo, branch });
    return data.commit.sha;
  } catch (e) {
    const status = (e as { status?: unknown } | null)?.status;
    if (status === 404 || status === 409) return null;
    throw e;
  }
}

/**
 * The gzipped tarball of a commit, as a stream (it is counted on the fly, never buffered whole).
 * GitHub redirects to a short-lived codeload URL that carries its own token.
 */
export async function fetchTarball(owner: string, repo: string, ref: string): Promise<Readable> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "github-repo-stats", accept: "application/vnd.github+json" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) throw new Error(`tarball ${owner}/${repo}@${ref.slice(0, 7)}: HTTP ${res.status}`);
  return Readable.fromWeb(res.body as unknown as WebReadableStream);
}

/** Weekly commit counts for the last year. GitHub returns 202 while computing; we return [] then. */
export async function fetchCommitActivity(owner: string, repo: string) {
  const res = await getOctokit().rest.repos.getCommitActivityStats({ owner, repo });
  return Array.isArray(res.data) ? res.data : [];
}

/** The token's own account: login, creation date and follower counts. */
export async function fetchViewer() {
  const { data } = await getOctokit().rest.users.getAuthenticated();
  return {
    login: data.login,
    createdAt: data.created_at,
    followers: data.followers,
    following: data.following,
    publicRepos: data.public_repos,
  };
}

export type ContributionYear = {
  commits: number;
  pullRequests: number;
  issues: number;
  reviews: number;
  reposWithCommits: number;
  restricted: number;
  total: number;
  days: { date: string; count: number }[];
  repos: { repo: string; commits: number; pullRequests: number }[];
};

const CONTRIBUTIONS_QUERY = /* GraphQL */ `
  query ($from: DateTime!, $to: DateTime!) {
    viewer {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalRepositoriesWithContributedCommits
        restrictedContributionsCount
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
        commitContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions { totalCount }
        }
        pullRequestContributionsByRepository(maxRepositories: 100) {
          repository { nameWithOwner }
          contributions { totalCount }
        }
      }
    }
  }
`;

type ByRepo = { repository: { nameWithOwner: string }; contributions: { totalCount: number } }[];
type ContributionsResponse = {
  viewer: {
    contributionsCollection: {
      totalCommitContributions: number;
      totalIssueContributions: number;
      totalPullRequestContributions: number;
      totalPullRequestReviewContributions: number;
      totalRepositoriesWithContributedCommits: number;
      restrictedContributionsCount: number;
      contributionCalendar: { totalContributions: number; weeks: { contributionDays: { date: string; contributionCount: number }[] }[] };
      commitContributionsByRepository: ByRepo;
      pullRequestContributionsByRepository: ByRepo;
    };
  };
};

/**
 * The token user's contributions between two instants (GraphQL; GitHub allows at most one year
 * per query). Includes private contributions the token can see; others only in `restricted`.
 */
export async function fetchContributions(from: Date, to: Date): Promise<ContributionYear> {
  const res = await getOctokit().graphql<ContributionsResponse>(CONTRIBUTIONS_QUERY, {
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const c = res.viewer.contributionsCollection;
  const repos = new Map<string, { repo: string; commits: number; pullRequests: number }>();
  const add = (list: ByRepo, key: "commits" | "pullRequests") => {
    for (const r of list) {
      const name = r.repository.nameWithOwner;
      const cur = repos.get(name) ?? { repo: name, commits: 0, pullRequests: 0 };
      cur[key] += r.contributions.totalCount;
      repos.set(name, cur);
    }
  };
  add(c.commitContributionsByRepository, "commits");
  add(c.pullRequestContributionsByRepository, "pullRequests");
  return {
    commits: c.totalCommitContributions,
    pullRequests: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
    reposWithCommits: c.totalRepositoriesWithContributedCommits,
    restricted: c.restrictedContributionsCount,
    total: c.contributionCalendar.totalContributions,
    days: c.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount }))),
    repos: [...repos.values()],
  };
}
