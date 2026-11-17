import type { Metadata } from "next";
import { and, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/LocalTime";
import { SyncNowButton } from "@/components/SyncNowButton";
import { isAppMode } from "@/lib/app-mode";
import { getDb, schema } from "@/lib/db";
import { installUrl } from "@/lib/github-cached";
import { getScope, getSession } from "@/lib/scope";
import { deleteMyData } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account · GitHub Repo Stats" };

export default async function Account() {
  if (!isAppMode()) notFound();
  const session = await getSession();
  if (!session) notFound();
  const { installationIds } = await getScope();
  const { installations } = schema;
  const rows = installationIds?.length
    ? await getDb()
        .select({
          id: installations.id,
          account: installations.accountLogin,
          type: installations.accountType,
          lastSyncedAt: installations.lastSyncedAt,
          // Written out in full: drizzle drops table prefixes inside a subquery, making the match ambiguous
          repos: sql<number>`(select count(*)::int from repos r where r.installation_id = "installations"."id")`,
        })
        .from(installations)
        .where(and(inArray(installations.id, installationIds)))
    : [];
  const manage = await installUrl();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Account</h1>

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Connected accounts</h2>
        {rows.length ? (
          <ul className="space-y-2 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  {r.account} <span className="text-xs text-zinc-500">{r.type === "Organization" ? "organization" : "personal"}</span>
                </span>
                <span className="text-xs text-zinc-500">
                  {r.repos} repos · last synced {r.lastSyncedAt ? <LocalTime iso={r.lastSyncedAt.toISOString()} /> : "never"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">The GitHub App isn&apos;t installed on any account you can access yet.</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <a href={manage} className="text-sm text-accent hover:underline">
            {rows.length ? "Choose repositories / install on another account" : "Install the GitHub App"} →
          </a>
          {rows.length > 0 && <SyncNowButton />}
        </div>
        <p className="mt-3 text-xs text-zinc-500">Everything syncs automatically every night; “Sync now” works at most every 15 minutes.</p>
      </section>

      <section className="rounded-xl border border-red-900/60 p-4">
        <h2 className="text-sm font-medium text-red-300">Delete my data</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Removes everything stored for your personal account: your repos&apos; traffic history, stars, code stats, notes and
          alerts, your contributions and follower history, and your sign-in token. History GitHub no longer keeps can&apos;t be
          recovered. Organization installations are kept for their other members.
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          <b>First uninstall the App</b> on GitHub (Settings → Applications → Installed GitHub Apps), or the next sync will start
          collecting again.
        </p>
        <form action={deleteMyData} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="confirm"
            placeholder={`Type ${session.login} to confirm`}
            autoComplete="off"
            className="w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-red-500"
          />
          <button className="rounded-md bg-red-900/60 px-3 py-1 text-sm text-red-100 hover:bg-red-800">Delete my data</button>
        </form>
      </section>
    </div>
  );
}

