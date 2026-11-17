import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Octokit } from "@octokit/rest";
import { currentGitHub } from "./github-context";

let _octokit: Octokit | null = null;

/** Octokit options shared by every client this app creates. */
export const OCTOKIT_DEFAULTS = {
  userAgent: "github-repo-stats",
  // Octokit logs every failed request; the sync expects some (403 for a missing optional
  // permission) and reports real failures itself, so keep the console readable.
  log: { debug: () => {}, info: () => {}, warn: console.warn, error: () => {} },
};

/** The client for the current context (an App installation or user), else the personal token. */
export function getOctokit() {
  const ctx = currentGitHub();
  if (ctx) return ctx.octokit;
  if (!_octokit) {
    const auth = process.env.GITHUB_TOKEN;
    if (!auth) throw new Error("GITHUB_TOKEN is not set");
    _octokit = new Octokit({ auth, ...OCTOKIT_DEFAULTS });
  }
  return _octokit;
}

/** All repositories owned by the token's user. */
/** Repos to sync: those the App installation can see, or (personal token) the repos you own. */
export async function listOwnedRepos() {
  const octokit = getOctokit();
  if (currentGitHub()?.installationId) {
    const repos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, { per_page: 100 });
    return repos as unknown as Awaited<ReturnType<typeof octokit.rest.repos.listForAuthenticatedUser>>["data"];
  }
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
  const ctx = currentGitHub();
  const token = ctx ? await ctx.token() : process.env.GITHUB_TOKEN;
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

// --- Repo activity (M3.7): issues & PRs, Actions runs, community health, Dependabot ------------

const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;

export type IssueItem = {
  number: number;
  isPr: boolean;
  title: string;
  author: string | null;
  authorAssociation: string;
  isBot: boolean;
  state: "open" | "closed";
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
};

/**
 * Issues and pull requests (GitHub's issues list includes both) updated since `since`, or all of
 * them when `since` is null. One request per 100 items; usually a single empty page per day.
 * Null when the token can't read them — private repos need the "Issues: Read-only" and
 * "Pull requests: Read-only" permissions on a fine-grained token.
 */
export async function fetchIssues(owner: string, repo: string, since: Date | null, hasIssues = true): Promise<IssueItem[] | null> {
  const octokit = getOctokit();
  if (!hasIssues) return fetchPullsOnly(owner, repo, since);
  let rows;
  try {
    rows = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    state: "all",
    sort: "updated",
    direction: "asc",
    per_page: 100,
    ...(since ? { since: since.toISOString() } : {}),
    });
  } catch (e) {
    if (statusOf(e) === 410) return fetchPullsOnly(owner, repo, since); // issues turned off
    if (statusOf(e) === 403) return null;
    throw e;
  }
  return rows.map((i) => ({
    number: i.number,
    isPr: !!i.pull_request,
    title: i.title.slice(0, 300),
    author: i.user?.login ?? null,
    authorAssociation: i.author_association ?? "NONE",
    isBot: i.user?.type === "Bot" || !!i.user?.login?.endsWith("[bot]"),
    state: i.state === "closed" ? "closed" : "open",
    createdAt: i.created_at,
    closedAt: i.closed_at ?? null,
    mergedAt: i.pull_request?.merged_at ?? null,
  }));
}

/** Pull requests only, for repos with issues turned off (the pulls list has no `since`: newest first, stop early). */
async function fetchPullsOnly(owner: string, repo: string, since: Date | null): Promise<IssueItem[] | null> {
  const octokit = getOctokit();
  const out: IssueItem[] = [];
  try {
    return await collectPulls(octokit, owner, repo, since, out);
  } catch (e) {
    if (statusOf(e) === 403) return null;
    throw e;
  }
}

async function collectPulls(octokit: Octokit, owner: string, repo: string, since: Date | null, out: IssueItem[]) {
  for await (const res of octokit.paginate.iterator(octokit.rest.pulls.list, {
    owner,
    repo,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: 100,
  })) {
    for (const p of res.data) {
      if (since && new Date(p.updated_at) < since) return out;
      out.push({
        number: p.number,
        isPr: true,
        title: p.title.slice(0, 300),
        author: p.user?.login ?? null,
        authorAssociation: p.author_association ?? "NONE",
        isBot: p.user?.type === "Bot" || !!p.user?.login?.endsWith("[bot]"),
        state: p.state === "closed" ? "closed" : "open",
        createdAt: p.created_at,
        closedAt: p.closed_at ?? null,
        mergedAt: p.merged_at ?? null,
      });
    }
  }
  return out;
}

export type WorkflowRunItem = {
  runId: number;
  workflow: string;
  event: string;
  branch: string | null;
  status: string;
  conclusion: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
};

/** Max pages of Actions runs per sync (GitHub caps filtered run lists at 1,000 anyway). */
const MAX_RUN_PAGES = 10;

/**
 * GitHub Actions runs created at or after `since`. Returns null when the token can't read Actions
 * (needs the "Actions: Read-only" permission) or Actions is unavailable for the repo.
 */
export async function fetchWorkflowRuns(owner: string, repo: string, since: Date): Promise<WorkflowRunItem[] | null> {
  const octokit = getOctokit();
  const out: WorkflowRunItem[] = [];
  try {
    let page = 0;
    for await (const res of octokit.paginate.iterator(octokit.rest.actions.listWorkflowRunsForRepo, {
      owner,
      repo,
      per_page: 100,
      created: `>=${since.toISOString().slice(0, 19)}Z`,
      exclude_pull_requests: true,
    })) {
      for (const r of res.data) {
        out.push({
          runId: r.id,
          workflow: r.name ?? r.path ?? "workflow",
          event: r.event,
          branch: r.head_branch ?? null,
          status: r.status ?? "unknown",
          conclusion: r.conclusion ?? null,
          createdAt: r.created_at,
          startedAt: r.run_started_at ?? null,
          updatedAt: r.updated_at,
        });
      }
      if (++page >= MAX_RUN_PAGES) break;
    }
  } catch (e) {
    if (statusOf(e) === 403 || statusOf(e) === 404) return null;
    throw e;
  }
  return out;
}

export type CommunityHealth = {
  percentage: number | null;
  readme: boolean;
  license: boolean;
  codeOfConduct: boolean;
  contributing: boolean;
  issueTemplate: boolean;
  prTemplate: boolean;
  description: boolean;
};

/** GitHub's community profile (health %, README, license, …). Null where GitHub has none (private repos). */
export async function fetchCommunityHealth(owner: string, repo: string): Promise<CommunityHealth | null> {
  try {
    const { data } = await getOctokit().rest.repos.getCommunityProfileMetrics({ owner, repo });
    const f = data.files;
    return {
      percentage: data.health_percentage ?? null,
      readme: !!f.readme,
      license: !!f.license,
      codeOfConduct: !!(f.code_of_conduct ?? f.code_of_conduct_file),
      contributing: !!f.contributing,
      issueTemplate: !!f.issue_template,
      prTemplate: !!f.pull_request_template,
      description: !!data.description,
    };
  } catch (e) {
    if (statusOf(e) === 404 || statusOf(e) === 403) return null;
    throw e;
  }
}

export type DependabotCounts = { critical: number; high: number; medium: number; low: number };

/**
 * Open Dependabot alerts by severity. Null when the token can't read them ("Dependabot alerts:
 * Read-only" permission) or alerts are disabled for the repo — GitHub answers 403/404 for both.
 */
export async function fetchDependabotAlerts(owner: string, repo: string): Promise<DependabotCounts | null> {
  const octokit = getOctokit();
  try {
    const alerts = await octokit.paginate(octokit.rest.dependabot.listAlertsForRepo, { owner, repo, state: "open", per_page: 100 });
    const counts: DependabotCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const a of alerts) {
      const sev = a.security_advisory?.severity ?? a.security_vulnerability?.severity;
      if (sev && sev in counts) counts[sev as keyof DependabotCounts]++;
    }
    return counts;
  } catch (e) {
    if (statusOf(e) === 403 || statusOf(e) === 404) return null;
    throw e;
  }
}

// --- Deployments (M3.9) --------------------------------------------------------------------------

export type DeploymentItem = {
  deploymentId: number;
  environment: string;
  ref: string | null;
  creator: string | null;
  createdAt: string;
};

/** Max deployments read per repo per sync (newest first). */
const MAX_DEPLOYMENTS = 300;

/**
 * Deployments created after `since`, newest first (Vercel, Netlify, GitHub Pages and Actions
 * environments all report here). Null when the token can't read them ("Deployments: Read-only").
 */
export async function fetchDeployments(owner: string, repo: string, since: Date): Promise<DeploymentItem[] | null> {
  const octokit = getOctokit();
  const out: DeploymentItem[] = [];
  try {
    for await (const res of octokit.paginate.iterator(octokit.rest.repos.listDeployments, { owner, repo, per_page: 100 })) {
      for (const d of res.data) {
        if (new Date(d.created_at) < since || out.length >= MAX_DEPLOYMENTS) return out;
        out.push({
          deploymentId: d.id,
          environment: d.environment ?? "unknown",
          ref: d.ref ?? null,
          creator: d.creator?.login ?? null,
          createdAt: d.created_at,
        });
      }
    }
  } catch (e) {
    if (statusOf(e) === 403 || statusOf(e) === 404) return null;
    throw e;
  }
  return out;
}

/** A deployment's latest status (success, failure, error, inactive, in_progress, …), null if none yet. */
export async function fetchDeploymentState(owner: string, repo: string, deploymentId: number): Promise<string | null> {
  const { data } = await getOctokit().rest.repos.listDeploymentStatuses({ owner, repo, deployment_id: deploymentId, per_page: 1 });
  return data[0]?.state ?? null;
}
