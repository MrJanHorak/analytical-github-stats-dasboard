import { AsyncLocalStorage } from "node:async_hooks";
import type { Octokit } from "@octokit/rest";

/**
 * Which GitHub identity the current sync runs as. Unset = the personal token (GITHUB_TOKEN). In
 * App mode the sync runs each installation inside `withGitHub(...)`, and every fetcher in
 * github.ts picks the installation's (or, for contributions, the user's) client up from here.
 */
export type GitHubContext = {
  octokit: Octokit;
  /** A current token for raw fetches (tarballs); installation tokens refresh themselves. */
  token: () => Promise<string>;
  /** Set when syncing a GitHub App installation: repos come from the installation, not /user/repos. */
  installationId?: number;
};

const store = new AsyncLocalStorage<GitHubContext>();

export const currentGitHub = () => store.getStore();
export const withGitHub = <T>(ctx: GitHubContext, fn: () => Promise<T>) => store.run(ctx, fn);
