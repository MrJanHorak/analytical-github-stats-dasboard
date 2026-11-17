import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { appConfig } from "./app-mode";
import type { GitHubContext } from "./github-context";
import { OCTOKIT_DEFAULTS } from "./github";
import { normalizePrivateKey } from "./private-key";

/**
 * GitHub App plumbing (App mode only). No Next.js imports, so the CLI sync can use it.
 *
 * - The App itself (JWT signed with its private key) lists installations.
 * - Each installation gets short-lived installation tokens: what the sync uses to read repos.
 * - Each user gets an 8-hour user token from sign-in (or a refresh): needed for things only a user
 *   token can see, like their contribution calendar and which installations they can access.
 */

let keyCache: { raw: string; pem: string } | null = null;
function appCredentials() {
  const { appId, privateKey } = appConfig();
  if (keyCache?.raw !== privateKey) keyCache = { raw: privateKey, pem: normalizePrivateKey(privateKey) };
  return { appId, privateKey: keyCache.pem };
}

export function appOctokit() {
  const { appId, privateKey } = appCredentials();
  return new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey }, ...OCTOKIT_DEFAULTS });
}

/** A sync context for one installation; tokens are minted and renewed automatically. */
export function installationContext(installationId: number): GitHubContext {
  const { appId, privateKey } = appCredentials();
  const octokit = new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey, installationId }, ...OCTOKIT_DEFAULTS });
  return {
    octokit,
    installationId,
    token: async () => ((await octokit.auth({ type: "installation" })) as { token: string }).token,
  };
}

/** A context acting as a user (for their contributions). */
export function userContext(accessToken: string): GitHubContext {
  return { octokit: new Octokit({ auth: accessToken, ...OCTOKIT_DEFAULTS }), token: async () => accessToken };
}

export type AppInstallation = { id: number; accountLogin: string; accountId: number; accountType: string };

const toInstallation = (i: { id: number; account: unknown }): AppInstallation | null => {
  const a = i.account as { login?: string; slug?: string; id?: number; type?: string } | null;
  if (!a?.id) return null;
  return { id: i.id, accountLogin: a.login ?? a.slug ?? String(a.id), accountId: a.id, accountType: a.type ?? (a.slug ? "Organization" : "User") };
};

/** Every current installation of the App. */
export async function listAppInstallations(): Promise<AppInstallation[]> {
  const app = appOctokit();
  const all = await app.paginate(app.rest.apps.listInstallations, { per_page: 100 });
  return all.map(toInstallation).filter((i): i is AppInstallation => !!i);
}

/** The App's URL slug (github.com/apps/<slug>), for install links. */
export async function fetchAppSlug(): Promise<string> {
  const { data } = await appOctokit().rest.apps.getAuthenticated();
  return data?.slug ?? "";
}

export type UserTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** When the refresh token stops working (GitHub: 6 months), null if GitHub didn't say */
  refreshExpiresAt: Date | null;
};

async function tokenRequest(params: Record<string, string>): Promise<UserTokens> {
  const { clientId, clientSecret } = appConfig();
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) throw new Error(`GitHub token exchange failed: ${data.error_description ?? data.error ?? res.status}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    refreshExpiresAt: data.refresh_token_expires_in ? new Date(Date.now() + data.refresh_token_expires_in * 1000) : null,
  };
}

/** Sign-in: swap the OAuth code for user tokens. */
export const exchangeCode = (code: string, redirectUri: string) => tokenRequest({ code, redirect_uri: redirectUri });

/** Renew a user's access token. GitHub rotates the refresh token too — store the new one. */
export const refreshUserToken = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

/** The signed-in user's profile and the App installations they can access. */
export async function fetchUserAndInstallations(accessToken: string) {
  const octokit = new Octokit({ auth: accessToken, ...OCTOKIT_DEFAULTS });
  const [{ data: user }, installs] = await Promise.all([
    octokit.rest.users.getAuthenticated(),
    octokit.paginate(octokit.rest.apps.listInstallationsForAuthenticatedUser, { per_page: 100 }),
  ]);
  return {
    user: { id: user.id, login: user.login, name: user.name ?? null, avatarUrl: user.avatar_url ?? null, email: user.email ?? null },
    installations: installs.map(toInstallation).filter((i): i is AppInstallation => !!i),
  };
}
