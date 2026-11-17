/**
 * Sign-in (GitHub App) mode against in-memory Postgres: users and their tokens, which repos each
 * user can see, deleting a user's data, the webhook restriction, and the all-installations sync.
 * GitHub itself is mocked.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { notifyAlerts, type AlertConfig } from "@/lib/alerts";
import { decrypt } from "@/lib/crypto";
import { schema, setDbForTesting } from "@/lib/db";
import * as githubApp from "@/lib/github-app";
import { getExportData, getMe, getOverview, getRepoDetail, type Scope } from "@/lib/queries";
import * as sync from "@/lib/sync";
import { syncAllInstallations } from "@/lib/sync-app";
import { deleteUserData, linkInstallations, markRemovedInstallations, recordSignIn, userAccessToken, userForInstallation } from "@/lib/users";
import { daysAgo, isoDay } from "@/lib/utils";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/github-app", () => ({
  refreshUserToken: vi.fn(),
  listAppInstallations: vi.fn(),
  installationContext: vi.fn((id: number) => ({ octokit: {}, token: async () => `inst-${id}`, installationId: id })),
  userContext: vi.fn((token: string) => ({ octokit: {}, token: async () => token })),
}));
vi.mock("@/lib/sync", () => ({ runSync: vi.fn() }));
const app = vi.mocked(githubApp);
const runSync = vi.mocked(sync.runSync);

const ENV = {
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "pem",
  GITHUB_APP_CLIENT_ID: "cid",
  GITHUB_APP_CLIENT_SECRET: "csecret",
  AUTH_SECRET: "test-secret",
};

let pg: PGlite;
const JAN = { id: 100, login: "jan", name: "Jan", avatarUrl: null, email: null };
const ANA = { id: 200, login: "ana", name: "Ana", avatarUrl: null, email: null };
const inst = (id: number, accountLogin: string, accountId: number, accountType = "User") => ({ id, accountLogin, accountId, accountType });

beforeAll(async () => {
  Object.assign(process.env, ENV);
  pg = new PGlite();
  const dir = join(__dirname, "..", "drizzle");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  setDbForTesting(drizzle(pg, { schema }));
  // Jan's installation (1) has jan/app; Ana's (2) has ana/secret; the org "acme" (3) has acme/tool
  await pg.exec(`
    insert into repos (id, owner, name, full_name, html_url, private, installation_id) values
      (11, 'jan', 'app', 'jan/app', 'x', false, 1),
      (22, 'ana', 'secret', 'ana/secret', 'x', true, 2),
      (33, 'acme', 'tool', 'acme/tool', 'x', false, 3);
  `);
  for (let back = 5; back >= 1; back--)
    await pg.exec(`insert into traffic_daily values (11, '${daysAgo(back)}', 10, 5, 1, 1), (22, '${daysAgo(back)}', 100, 50, 7, 3), (33, '${daysAgo(back)}', 3, 2, 0, 0)`);
  await pg.exec(`
    insert into contribution_years (login, year, commits, pull_requests, issues, reviews, repos_with_commits, restricted, total, synced_at)
      values ('jan', 2026, 10, 1, 1, 0, 1, 0, 12, now()), ('ana', 2026, 99, 9, 9, 9, 9, 0, 126, now());
    insert into profile_snapshots values ('jan', '${isoDay()}', 5, 1, 3), ('ana', '${isoDay()}', 50, 2, 9);
    insert into annotations (repo_id, date, label) values (22, '${daysAgo(2)}', 'Ana launch');
  `);
});

afterAll(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
});

describe("sign-in records", () => {
  it("stores the user, an encrypted refresh token and the installations they can see", async () => {
    await recordSignIn(JAN, { accessToken: "a1", refreshToken: "ghr_jan_1", refreshExpiresAt: null }, [inst(1, "jan", 100), inst(3, "acme", 900, "Organization")]);
    await recordSignIn(ANA, { accessToken: "a2", refreshToken: "ghr_ana_1", refreshExpiresAt: null }, [inst(2, "ana", 200)]);
    const tok = await pg.query<{ refresh_token_enc: string }>("select refresh_token_enc from user_tokens where user_id = 100");
    expect(tok.rows[0].refresh_token_enc).not.toContain("ghr_");
    expect(decrypt(tok.rows[0].refresh_token_enc, ENV.AUTH_SECRET)).toBe("ghr_jan_1");
    const links = await pg.query("select user_id::int, installation_id::int from user_installations order by 1, 2");
    expect(links.rows).toEqual([
      { user_id: 100, installation_id: 1 },
      { user_id: 100, installation_id: 3 },
      { user_id: 200, installation_id: 2 },
    ]);
    // Re-linking replaces the set (e.g. Jan left the org)
    await linkInstallations(100, [inst(1, "jan", 100)]);
    await linkInstallations(100, [inst(1, "jan", 100), inst(3, "acme", 900, "Organization")]);
    expect((await pg.query("select count(*)::int as n from user_installations where user_id = 100")).rows[0]).toEqual({ n: 2 });
  });

  it("refreshes a user's token, storing the rotated refresh token; forgets one that stopped working", async () => {
    app.refreshUserToken.mockResolvedValueOnce({ accessToken: "fresh", refreshToken: "ghr_jan_2", refreshExpiresAt: null });
    expect(await userAccessToken(100)).toBe("fresh");
    expect(app.refreshUserToken).toHaveBeenCalledWith("ghr_jan_1");
    const tok = await pg.query<{ refresh_token_enc: string }>("select refresh_token_enc from user_tokens where user_id = 100");
    expect(decrypt(tok.rows[0].refresh_token_enc, ENV.AUTH_SECRET)).toBe("ghr_jan_2");

    app.refreshUserToken.mockRejectedValueOnce(new Error("bad_refresh_token"));
    expect(await userAccessToken(200)).toBeNull();
    expect((await pg.query("select count(*)::int as n from user_tokens where user_id = 200")).rows[0]).toEqual({ n: 0 });
    expect(await userAccessToken(999)).toBeNull();
  });

  it("finds the owner of a personal installation, not of an organization's", async () => {
    expect(await userForInstallation(1)).toEqual({ id: 100, login: "jan" });
    expect(await userForInstallation(3)).toBeNull();
  });
});

describe("scoping", () => {
  const jan: Scope = { repoIds: [11, 33], logins: ["jan"], installationIds: [1, 3] };
  const nobody: Scope = { repoIds: [], logins: [], installationIds: [] };

  it("shows each user only their installations' repos, totals, notes and contributions", async () => {
    const o = await getOverview(30, jan);
    expect(o.repos.map((r) => r.fullName).sort()).toEqual(["acme/tool", "jan/app"]);
    expect(o.totals.views).toBe(65); // 5×10 + 5×3 — not Ana's 500
    expect(o.markers).toEqual([]); // Ana's note isn't visible
    expect((await getOverview(30, nobody)).repos).toEqual([]);

    expect(await getRepoDetail("ana", "secret", 30, jan)).toBeNull();
    expect((await getRepoDetail("jan", "app", 30, jan))?.repo.fullName).toBe("jan/app");

    const daily = await getExportData("daily", 30, jan);
    expect(new Set(daily.map((d) => (d as { repo: string }).repo))).toEqual(new Set(["jan/app", "acme/tool"]));

    expect((await getMe(isoDay(), jan))?.totals.commits).toBe(10);
    expect(await getMe(isoDay(), nobody)).toBeNull();
  });
});

describe("webhook in App mode", () => {
  const base: AlertConfig = { enabled: true, spikeFactor: 3, minViews: 25, minClones: 10, starBurst: 5, baselineDays: 7, webhookUrl: "https://hook.test", appMode: true };

  it("only posts alerts for the webhook owner's repos, and nothing without an owner", async () => {
    await pg.exec(`insert into alerts (repo_id, date, kind, message, value) values (11, '${daysAgo(1)}', 'views_spike', 'jan/app spiked', 1), (22, '${daysAgo(1)}', 'views_spike', 'ana/secret spiked', 1)`);
    const f = vi.fn().mockResolvedValue(new Response("ok"));
    expect(await notifyAlerts(base, f)).toBe(0);
    expect(await notifyAlerts({ ...base, webhookOwner: "JAN" }, f)).toBe(1);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.text).toContain("jan/app");
    expect(body.text).not.toContain("ana/secret");
  });
});

describe("syncing all installations", () => {
  it("syncs each installation with its token, contributions only for signed-in personal accounts, then alerts once", async () => {
    await pg.exec("insert into installations (id, account_login, account_id, account_type) values (77, 'gone', 777, 'User') on conflict do nothing");
    app.listAppInstallations.mockResolvedValue([inst(1, "jan", 100), inst(2, "ana", 200), inst(3, "acme", 900, "Organization")]);
    app.refreshUserToken.mockResolvedValue({ accessToken: "jan-fresh", refreshToken: "ghr_jan_3", refreshExpiresAt: null });
    runSync.mockResolvedValue({ reposSynced: 1, historyPending: 0, codeStatsPending: 0, activityPending: 0, contributionYearsPending: 0, alertsCreated: 0, starHistoryUnavailable: [], errors: [] });

    const r = await syncAllInstallations();
    expect(r.installations.map((i) => i.installation)).toEqual(["jan", "ana", "acme"]);
    const calls = runSync.mock.calls.map(([o]) => ({ id: o?.installationId, contributions: o?.contributions ? "user" : o?.contributions, skipAlerts: o?.skipAlerts }));
    expect(calls).toEqual([
      { id: 1, contributions: "user", skipAlerts: true }, // Jan signed in and has a token
      { id: 2, contributions: null, skipAlerts: true }, // Ana's token was dropped above → skip her contributions
      { id: 3, contributions: null, skipAlerts: true }, // organizations have no contributions
    ]);
    expect(app.userContext).toHaveBeenCalledWith("jan-fresh");
    const synced = await pg.query("select id::int, last_synced_at is not null as synced, removed_at is not null as removed from installations order by id");
    expect(synced.rows).toEqual([
      { id: 1, synced: true, removed: false },
      { id: 2, synced: true, removed: false },
      { id: 3, synced: true, removed: false },
      { id: 77, synced: false, removed: true }, // uninstalled: no longer listed by GitHub
    ]);
    await markRemovedInstallations([1, 2, 3]); // idempotent
  });
});

describe("delete my data", () => {
  it("removes the user's personal installation, its repos and stats, contributions and tokens — nobody else's", async () => {
    await deleteUserData(200); // Ana
    expect((await pg.query("select full_name from repos order by 1")).rows).toEqual([{ full_name: "acme/tool" }, { full_name: "jan/app" }]);
    expect((await pg.query("select count(*)::int as n from traffic_daily where repo_id = 22")).rows[0]).toEqual({ n: 0 });
    expect((await pg.query("select count(*)::int as n from annotations")).rows[0]).toEqual({ n: 0 });
    expect((await pg.query("select count(*)::int as n from alerts where repo_id = 22")).rows[0]).toEqual({ n: 0 });
    expect((await pg.query("select login from contribution_years")).rows).toEqual([{ login: "jan" }]);
    expect((await pg.query("select count(*)::int as n from users where id = 200")).rows[0]).toEqual({ n: 0 });
    expect((await pg.query("select count(*)::int as n from installations where id = 2")).rows[0]).toEqual({ n: 0 });
    // Jan's data is untouched
    expect((await pg.query("select count(*)::int as n from traffic_daily where repo_id = 11")).rows[0]).toEqual({ n: 5 });
  });
});
