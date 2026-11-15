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

export async function fetchLanguages(owner: string, repo: string) {
  const { data } = await getOctokit().rest.repos.listLanguages({ owner, repo });
  return data;
}

/** Weekly commit counts for the last year. GitHub returns 202 while computing; we return [] then. */
export async function fetchCommitActivity(owner: string, repo: string) {
  const res = await getOctokit().rest.repos.getCommitActivityStats({ owner, repo });
  return Array.isArray(res.data) ? res.data : [];
}
