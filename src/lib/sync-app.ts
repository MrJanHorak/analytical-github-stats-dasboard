import { eq } from "drizzle-orm";
import { alertConfigFromEnv, evaluateAlerts, notifyAlerts } from "./alerts";
import { getDb, schema } from "./db";
import { installationContext, listAppInstallations, userContext } from "./github-app";
import { withGitHub } from "./github-context";
import { runSync, type SyncResult } from "./sync";
import { markRemovedInstallations, upsertInstallations, userAccessToken, userForInstallation } from "./users";

const { installations } = schema;

/**
 * Sync one App installation: its repos with the installation's token, and — for a personal
 * account whose owner has signed in — their contributions with their own (refreshed) user token.
 */
export async function syncInstallation(installationId: number, opts: { timeBudgetMs?: number; skipAlerts?: boolean } = {}): Promise<SyncResult> {
  const owner = await userForInstallation(installationId);
  const token = owner ? await userAccessToken(owner.id) : null;
  const result = await withGitHub(installationContext(installationId), () =>
    runSync({
      timeBudgetMs: opts.timeBudgetMs,
      installationId,
      contributions: token ? userContext(token) : null,
      skipAlerts: opts.skipAlerts ?? true,
    }),
  );
  await getDb().update(installations).set({ lastSyncedAt: new Date() }).where(eq(installations.id, installationId));
  return result;
}

/**
 * The scheduled App-mode sync (GitHub Actions: `npm run sync:all`): refresh the list of
 * installations, sync each one in turn (each has its own 5,000 requests/hour), then judge alerts
 * once for everything.
 */
export async function syncAllInstallations(opts: { timeBudgetMs?: number } = {}) {
  const list = await listAppInstallations();
  await upsertInstallations(list);
  await markRemovedInstallations(list.map((i) => i.id));

  const results: { installation: string; result?: SyncResult; error?: string }[] = [];
  for (const inst of list) {
    try {
      results.push({ installation: inst.accountLogin, result: await syncInstallation(inst.id, opts) });
    } catch (e) {
      results.push({ installation: inst.accountLogin, error: e instanceof Error ? e.message : String(e) });
    }
  }

  let alertsCreated = 0;
  let alertsError: string | undefined;
  try {
    alertsCreated = (await evaluateAlerts()).length;
    await notifyAlerts(alertConfigFromEnv());
  } catch (e) {
    alertsError = e instanceof Error ? e.message : String(e);
  }
  return { installations: results, alertsCreated, alertsError };
}
