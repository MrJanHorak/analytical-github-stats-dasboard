import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { appConfig } from "./app-mode";
import { decrypt, encrypt } from "./crypto";
import { getDb, schema } from "./db";
import { type AppInstallation, refreshUserToken, type UserTokens } from "./github-app";

const { users, userTokens, installations, userInstallations, repos, contributionDays, contributionYears, contributionRepos, profileSnapshots, syncRuns } =
  schema;

type SignInUser = { id: number; login: string; name: string | null; avatarUrl: string | null; email: string | null };

/** Insert or update installations as GitHub reports them (un-removing any that came back). */
export async function upsertInstallations(list: AppInstallation[]) {
  if (!list.length) return;
  await getDb()
    .insert(installations)
    .values(list.map((i) => ({ id: i.id, accountLogin: i.accountLogin, accountId: i.accountId, accountType: i.accountType })))
    .onConflictDoNothing();
  // Existing ones: refresh the fields that can change (an account rename, a reinstall)
  for (const i of list)
    await getDb().update(installations).set({ accountLogin: i.accountLogin, accountType: i.accountType, removedAt: null }).where(eq(installations.id, i.id));
}

/**
 * After sign-in: store the user, their (encrypted) refresh token, and which installations they can
 * see — the ones GitHub lists for their user token, which covers their own account and orgs.
 */
export async function recordSignIn(user: SignInUser, tokens: UserTokens, visible: AppInstallation[]) {
  const db = getDb();
  const now = new Date();
  await db
    .insert(users)
    .values({ ...user, lastLoginAt: now })
    .onConflictDoUpdate({
      target: users.id,
      set: { login: user.login, name: user.name, avatarUrl: user.avatarUrl, email: user.email, lastLoginAt: now },
    });
  if (tokens.refreshToken) await storeRefreshToken(user.id, tokens.refreshToken, tokens.refreshExpiresAt);
  await linkInstallations(user.id, visible);
}

/** Replace a user's installation links with what GitHub says they can access now. */
export async function linkInstallations(userId: number, visible: AppInstallation[]) {
  const db = getDb();
  await upsertInstallations(visible);
  await db.delete(userInstallations).where(eq(userInstallations.userId, userId));
  if (visible.length) await db.insert(userInstallations).values(visible.map((i) => ({ userId, installationId: i.id }))).onConflictDoNothing();
}

async function storeRefreshToken(userId: number, refreshToken: string, expiresAt: Date | null) {
  const enc = encrypt(refreshToken, appConfig().authSecret);
  await getDb()
    .insert(userTokens)
    .values({ userId, refreshTokenEnc: enc, refreshExpiresAt: expiresAt, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userTokens.userId, set: { refreshTokenEnc: enc, refreshExpiresAt: expiresAt, updatedAt: new Date() } });
}

/**
 * A fresh access token for a user, from their stored refresh token (which GitHub rotates, so the
 * new one is saved). Null when there's none or it no longer works — they need to sign in again.
 */
export async function userAccessToken(userId: number): Promise<string | null> {
  const db = getDb();
  const [row] = await db.select().from(userTokens).where(eq(userTokens.userId, userId)).limit(1);
  if (!row) return null;
  const refresh = decrypt(row.refreshTokenEnc, appConfig().authSecret);
  if (!refresh) return null;
  try {
    const t = await refreshUserToken(refresh);
    if (t.refreshToken) await storeRefreshToken(userId, t.refreshToken, t.refreshExpiresAt);
    return t.accessToken;
  } catch {
    // Expired or revoked (user removed the App's authorization): forget it until the next sign-in
    await db.delete(userTokens).where(eq(userTokens.userId, userId));
    return null;
  }
}

/** The signed-in user whose personal account an installation belongs to (for their contributions). */
export async function userForInstallation(installationId: number) {
  const [row] = await getDb()
    .select({ id: users.id, login: users.login })
    .from(installations)
    .innerJoin(users, eq(users.id, installations.accountId))
    .where(and(eq(installations.id, installationId), eq(installations.accountType, "User")))
    .limit(1);
  return row ?? null;
}

/** Mark installations GitHub no longer lists as removed (their repos stop syncing and disappear from view). */
export async function markRemovedInstallations(currentIds: number[]) {
  await getDb()
    .update(installations)
    .set({ removedAt: new Date() })
    .where(and(isNull(installations.removedAt), currentIds.length ? notInArray(installations.id, currentIds) : undefined));
}

/** Every table keyed by repo_id, for deleting a user's data. */
function repoKeyedTables(): { table: PgTable; col: PgColumn }[] {
  return (Object.values(schema) as unknown[])
    .filter((t) => !!t && typeof t === "object" && "repoId" in t)
    .map((t) => ({ table: t as unknown as PgTable, col: (t as { repoId: PgColumn }).repoId }));
}

/**
 * "Delete my data": everything stored for the user's own account — their personal installation's
 * repos and all stats about them, their contributions and follower history, their token and links.
 * Organization installations are left alone (other members may use them). GitHub keeps the App
 * installed until they remove it there, so the next sync would collect data again; the account
 * page tells them to uninstall first.
 */
export async function deleteUserData(userId: number) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;
  const own = await db.select({ id: installations.id }).from(installations).where(eq(installations.accountId, userId));
  const ownIds = own.map((i) => i.id);
  if (ownIds.length) {
    const repoIds = (await db.select({ id: repos.id }).from(repos).where(inArray(repos.installationId, ownIds))).map((r) => r.id);
    if (repoIds.length) {
      for (const { table, col } of repoKeyedTables()) await db.delete(table).where(inArray(col, repoIds));
      await db.delete(repos).where(inArray(repos.id, repoIds));
    }
    await db.delete(syncRuns).where(inArray(syncRuns.installationId, ownIds));
    await db.delete(userInstallations).where(inArray(userInstallations.installationId, ownIds));
    await db.delete(installations).where(inArray(installations.id, ownIds));
  }
  for (const t of [contributionDays, contributionYears, contributionRepos, profileSnapshots]) await db.delete(t).where(eq(t.login, user.login));
  await db.delete(userTokens).where(eq(userTokens.userId, userId));
  await db.delete(userInstallations).where(eq(userInstallations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
