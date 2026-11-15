"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/lib/db";

const { annotations, repos } = schema;

/**
 * Notes are written through server actions, which POST to the page URL —
 * so they sit behind the same DASHBOARD_PASSWORD basic auth as the dashboard.
 */
export async function addNote(formData: FormData) {
  const fullName = String(formData.get("repo") ?? "");
  const date = String(formData.get("date") ?? "");
  const label = String(formData.get("label") ?? "").trim().slice(0, 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !label) return;

  const db = getDb();
  const [repo] = await db.select({ id: repos.id }).from(repos).where(eq(repos.fullName, fullName)).limit(1);
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
  const [repo] = await db.select({ id: repos.id }).from(repos).where(eq(repos.fullName, fullName)).limit(1);
  if (!repo) return;
  await db.delete(annotations).where(and(eq(annotations.id, id), eq(annotations.repoId, repo.id)));
  revalidatePath(`/repo/${fullName}`);
  revalidatePath("/");
}
