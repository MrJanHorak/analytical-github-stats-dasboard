import { and, eq, inArray, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { isAppMode } from "./app-mode";
import { getDb, schema } from "./db";
import { ALL_SCOPE, type Scope } from "./queries";
import { readSessionToken, SESSION_COOKIE, type Session } from "./session";

const { userInstallations, installations, repos } = schema;

/** The signed-in user (App mode), or null. */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!isAppMode()) return null;
  return readSessionToken((await cookies()).get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET);
});

/**
 * What the current request may see. Single-user mode: everything. App mode: the repos of the
 * installations the signed-in user can access (nothing when signed out), and their own login.
 */
export const getScope = cache(async (): Promise<Scope> => {
  if (!isAppMode()) return ALL_SCOPE;
  const session = await getSession();
  if (!session) return { repoIds: [], logins: [], installationIds: [] };
  const db = getDb();
  const insts = await db
    .select({ id: installations.id })
    .from(userInstallations)
    .innerJoin(installations, eq(installations.id, userInstallations.installationId))
    .where(and(eq(userInstallations.userId, session.userId), isNull(installations.removedAt)));
  const installationIds = insts.map((i) => i.id);
  const repoIds = installationIds.length
    ? (await db.select({ id: repos.id }).from(repos).where(inArray(repos.installationId, installationIds))).map((r) => r.id)
    : [];
  return { repoIds, logins: [session.login], installationIds };
});
