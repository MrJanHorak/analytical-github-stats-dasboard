import { sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import {
  fetchCommunityHealth,
  fetchDependabotAlerts,
  fetchIssues,
  fetchWorkflowRuns,
  type IssueItem,
  type WorkflowRunItem,
} from "./github";

const { issues, workflowRuns, repoHealth } = schema;
const excluded = (col: string) => sql.raw(`excluded.${col}`);

/** Actions runs fetched on a repo's first activity sync. */
export const RUNS_BACKFILL_DAYS = 90;
/** Community health is rechecked when the repo is pushed, or at least this often. */
const HEALTH_MAX_AGE_MS = 7 * 86_400_000;
/** Overlap with the previous sync so nothing that changed during it is missed (upserts make it harmless). */
const ISSUES_OVERLAP_MS = 10 * 60_000;
/** In-progress runs finish later; re-read runs created in the last day so their conclusion lands. */
const RUNS_OVERLAP_MS = 86_400_000;

export type ActivityRepo = {
  id: number;
  owner: { login: string };
  name: string;
  pushed_at?: string | null;
  has_issues?: boolean;
};
type Marker = typeof repoHealth.$inferSelect;

/** Stored activity state per repo (markers + last health check). */
export async function activityMarkers(): Promise<Map<number, Marker>> {
  const rows = await getDb().select().from(repoHealth);
  return new Map(rows.map((r) => [r.repoId, r]));
}

/**
 * One repo's activity: issues & PRs and Actions runs (incremental), open Dependabot alerts (daily),
 * and the community profile (when pushed, or weekly). Missing permissions are recorded, not errors.
 */
export async function syncRepoActivity(r: ActivityRepo, prev: Marker | undefined, now = new Date()) {
  const db = getDb();
  const owner = r.owner.login;

  // Issues & PRs updated since the last sync (everything on the first one)
  const issuesSince = prev?.issuesSyncedAt ? new Date(prev.issuesSyncedAt.getTime() - ISSUES_OVERLAP_MS) : null;
  const items = await fetchIssues(owner, r.name, issuesSince, r.has_issues ?? true);
  if (items) await upsertIssues(r.id, items);

  // Actions runs
  const runsSince = prev?.runsSyncedAt
    ? new Date(prev.runsSyncedAt.getTime() - RUNS_OVERLAP_MS)
    : new Date(now.getTime() - RUNS_BACKFILL_DAYS * 86_400_000);
  const runs = await fetchWorkflowRuns(owner, r.name, runsSince);
  if (runs) await upsertRuns(r.id, runs);

  // Community health: only when something may have changed
  const pushed = r.pushed_at ? new Date(r.pushed_at).getTime() : 0;
  const checked = prev?.healthCheckedAt?.getTime() ?? 0;
  const healthDue = !checked || pushed > checked || now.getTime() - checked > HEALTH_MAX_AGE_MS;
  const health = healthDue ? await fetchCommunityHealth(owner, r.name) : undefined;

  const dependabot = await fetchDependabotAlerts(owner, r.name);

  const row: typeof repoHealth.$inferInsert = {
    repoId: r.id,
    dependabotCritical: dependabot?.critical ?? null,
    dependabotHigh: dependabot?.high ?? null,
    dependabotMedium: dependabot?.medium ?? null,
    dependabotLow: dependabot?.low ?? null,
    actionsAvailable: runs !== null,
    issuesAvailable: items !== null,
    issuesSyncedAt: items ? now : (prev?.issuesSyncedAt ?? null),
    runsSyncedAt: runs ? now : (prev?.runsSyncedAt ?? null),
    activitySyncedAt: now,
    ...(health !== undefined
      ? {
          healthPercentage: health?.percentage ?? null,
          hasReadme: health?.readme ?? null,
          hasLicense: health?.license ?? null,
          hasCodeOfConduct: health?.codeOfConduct ?? null,
          hasContributing: health?.contributing ?? null,
          hasIssueTemplate: health?.issueTemplate ?? null,
          hasPrTemplate: health?.prTemplate ?? null,
          hasDescription: health?.description ?? null,
          healthCheckedAt: now,
        }
      : {}),
  };
  const set = Object.fromEntries(
    Object.keys(row)
      .filter((k) => k !== "repoId")
      .map((k) => [k, excluded(snake(k))]),
  );
  await db.insert(repoHealth).values(row).onConflictDoUpdate({ target: repoHealth.repoId, set });

  return { issues: items?.length ?? null, runs: runs?.length ?? null, healthChecked: healthDue };
}

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

async function upsertIssues(repoId: number, items: IssueItem[]) {
  const db = getDb();
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500).map((it) => ({
      repoId,
      number: it.number,
      isPr: it.isPr,
      title: it.title,
      author: it.author,
      authorAssociation: it.authorAssociation,
      isBot: it.isBot,
      state: it.state,
      createdAt: new Date(it.createdAt),
      closedAt: it.closedAt ? new Date(it.closedAt) : null,
      mergedAt: it.mergedAt ? new Date(it.mergedAt) : null,
    }));
    await db
      .insert(issues)
      .values(chunk)
      .onConflictDoUpdate({
        target: [issues.repoId, issues.number],
        set: {
          isPr: excluded("is_pr"),
          title: excluded("title"),
          authorAssociation: excluded("author_association"),
          state: excluded("state"),
          closedAt: excluded("closed_at"),
          mergedAt: excluded("merged_at"),
        },
      });
  }
}

async function upsertRuns(repoId: number, runs: WorkflowRunItem[]) {
  const db = getDb();
  for (let i = 0; i < runs.length; i += 500) {
    const chunk = runs.slice(i, i + 500).map((r) => ({
      repoId,
      runId: r.runId,
      workflow: r.workflow,
      event: r.event,
      branch: r.branch,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: new Date(r.createdAt),
      startedAt: r.startedAt ? new Date(r.startedAt) : null,
      updatedAt: new Date(r.updatedAt),
    }));
    await db
      .insert(workflowRuns)
      .values(chunk)
      .onConflictDoUpdate({
        target: [workflowRuns.repoId, workflowRuns.runId],
        set: {
          status: excluded("status"),
          conclusion: excluded("conclusion"),
          startedAt: excluded("started_at"),
          updatedAt: excluded("updated_at"),
        },
      });
  }
}

