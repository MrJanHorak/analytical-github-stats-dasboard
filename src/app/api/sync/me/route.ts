import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isAppMode } from "@/lib/app-mode";
import { getDb, schema } from "@/lib/db";
import { getScope, getSession } from "@/lib/scope";
import { syncInstallation } from "@/lib/sync-app";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Hobby's maximum

/** Don't let one person sync more often than this (the nightly GitHub Actions run does the rest). */
const MIN_INTERVAL_MS = 15 * 60_000;

/**
 * POST /api/sync/me — sync the signed-in user's installations now (App mode), so a new user sees
 * their stats straight away instead of after the nightly run. Traffic first, then as much history
 * as fits in ~4 minutes; the nightly sync finishes the rest.
 */
export async function POST() {
  if (!isAppMode()) return NextResponse.json({ error: "only in sign-in mode" }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const { installationIds } = await getScope();
  if (!installationIds?.length) return NextResponse.json({ error: "Install the GitHub App first" }, { status: 409 });

  const { installations } = schema;
  const rows = await getDb()
    .select()
    .from(installations)
    .where(and(inArray(installations.id, installationIds), isNull(installations.removedAt)));
  const due = rows.filter((r) => !r.lastSyncedAt || Date.now() - r.lastSyncedAt.getTime() > MIN_INTERVAL_MS);
  if (!due.length) return NextResponse.json({ synced: 0, message: "Synced in the last 15 minutes — try again later." });

  const started = Date.now();
  const budget = 240_000;
  const results = [];
  for (const inst of due) {
    const left = budget - (Date.now() - started);
    if (left < 30_000) break;
    // Claim it first so a double click doesn't start two syncs
    await getDb().update(installations).set({ lastSyncedAt: new Date() }).where(eq(installations.id, inst.id));
    let r;
    try {
      r = await syncInstallation(inst.id, { timeBudgetMs: left - 20_000 });
    } catch (e) {
      // A failed sync (e.g. bad App credentials) shouldn't lock the button for 15 minutes
      await getDb().update(installations).set({ lastSyncedAt: inst.lastSyncedAt }).where(eq(installations.id, inst.id));
      console.error("sync/me failed", e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
    results.push({ account: inst.accountLogin, reposSynced: r.reposSynced, errors: r.errors.length });
  }
  return NextResponse.json({ synced: results.length, results });
}
