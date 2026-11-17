"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/lib/db";
import { canSeeRepo } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { parseAlertOverride } from "@/lib/transform";

const { alertSettings, annotations, repos } = schema;

/**
 * The repo a form refers to, if the viewer may change it. Server actions POST to the page URL, so
 * they sit behind the same auth as the dashboard (basic auth, or sign-in in App mode) — and in App
 * mode a signed-in user can only touch repos of their own installations.
 */
async function writableRepo(fullName: string) {
  const [repo] = await getDb().select({ id: repos.id }).from(repos).where(eq(repos.fullName, fullName)).limit(1);
  if (!repo || !canSeeRepo(await getScope(), repo.id)) return null;
  return repo;
}

export async function addNote(formData: FormData) {
  const fullName = String(formData.get("repo") ?? "");
  const date = String(formData.get("date") ?? "");
  const label = String(formData.get("label") ?? "").trim().slice(0, 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !label) return;

  const db = getDb();
  const repo = await writableRepo(fullName);
  if (!repo) return;
  await db.insert(annotations).values({ repoId: repo.id, date, label });
  revalidatePath(`/repo/${fullName}`);
  revalidatePath("/");
}

export async function deleteNote(formData: FormData) {
  const id = Number(formData.get("id"));
  const fullName = String(formData.get("repo") ?? "");
  if (!Number.isInteger(id)) return;
  const db = getDb();
  const repo = await writableRepo(fullName);
  if (!repo) return;
  await db.delete(annotations).where(and(eq(annotations.id, id), eq(annotations.repoId, repo.id)));
  revalidatePath(`/repo/${fullName}`);
  revalidatePath("/");
}

/** Save (or clear) a repo's alert overrides. Blank fields fall back to the global ALERT_* settings. */
export async function saveAlertSettings(formData: FormData) {
  const fullName = String(formData.get("repo") ?? "");
  const db = getDb();
  const repo = await writableRepo(fullName);
  if (!repo) return;
  const override = formData.get("reset") ? null : parseAlertOverride((k) => (formData.get(k) as string | null) ?? null);
  if (!override) await db.delete(alertSettings).where(eq(alertSettings.repoId, repo.id));
  else
    await db
      .insert(alertSettings)
      .values({ repoId: repo.id, ...override, updatedAt: new Date() })
      .onConflictDoUpdate({ target: alertSettings.repoId, set: { ...override, updatedAt: new Date() } });
  revalidatePath(`/repo/${fullName}`);
}
