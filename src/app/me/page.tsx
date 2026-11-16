import type { Metadata } from "next";
import Link from "next/link";
import { TimeSeriesChart } from "@/components/charts";
import { Heatmap } from "@/components/Heatmap";
import { SetupNotice } from "@/components/SetupNotice";
import { StatCard } from "@/components/StatCard";
import { isDbConfigured } from "@/lib/db";
import { getMe } from "@/lib/queries";
import { fmt } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your activity · GitHub Repo Stats" };

export default async function MePage() {
  if (!isDbConfigured()) return <SetupNotice />;
  const me = await getMe();
  if (!me) {
    return (
      <div className="rounded-xl border border-zinc-800 p-6 text-sm text-zinc-400">
        Your contribution history appears after the next sync (<code>npm run sync</code> or the daily cron). The first sync
        fetches every year back to when your account was created.
      </div>
    );
  }
  const { totals, streaks, followers } = me;
  const maxYear = Math.max(1, ...me.years.map((y) => y.total));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your activity</h1>
        <p className="text-sm text-zinc-500">
          <a href={`https://github.com/${me.login}`} className="hover:text-accent" target="_blank">
            @{me.login}
          </a>
          {me.since && <> · contributions since {me.since}</>} · commits, PRs, issues and reviews in any repository, as GitHub
          counts them
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Contributions" value={me.lastYear} sub="last 12 months" note={`${fmt(totals.total)} all time`} />
        <StatCard label="Commits" value={totals.commits} sub="all time" />
        <StatCard label="Pull requests" value={totals.pullRequests} sub="all time" />
        <StatCard label="Issues opened" value={totals.issues} sub="all time" />
        <StatCard label="Reviews" value={totals.reviews} sub="all time" />
        <StatCard label="Repos contributed to" value={me.reposContributedTo} sub="commits or PRs" />
        <StatCard
          label="Current streak"
          value={streaks.current}
          sub={streaks.current === 1 ? "day" : "days"}
          note={streaks.longest ? `Longest: ${fmt(streaks.longest)} days, ending ${streaks.longestEnd}` : undefined}
        />
        <StatCard label="Followers" value={followers.current} delta={followers.delta30} sub="in 30 days" note={`Following ${fmt(followers.following)}`} />
      </div>

      <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">
          {fmt(me.lastYear)} contributions in the last year
        </h2>
        <Heatmap weeks={me.heatmap} />
        {totals.restricted > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            Includes {fmt(totals.restricted)} private contributions the token can count but not itemise.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Contributions per year</h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-2 text-left font-normal">Year</th>
                <th className="pb-2 font-normal" />
                <th className="pb-2 text-right font-normal">Commits</th>
                <th className="pb-2 text-right font-normal">PRs</th>
                <th className="pb-2 text-right font-normal">Issues</th>
                <th className="pb-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...me.years].reverse().map((y) => (
                <tr key={y.year} className="border-t border-zinc-800/60">
                  <td className="py-1.5 tabular-nums">{y.year}</td>
                  <td className="w-1/3 px-2">
                    <div className="h-2 rounded bg-emerald-500/70" style={{ width: `${(y.total / maxYear) * 100}%` }} />
                  </td>
                  <td className="text-right tabular-nums text-zinc-400">{fmt(y.commits)}</td>
                  <td className="text-right tabular-nums text-zinc-400">{fmt(y.pullRequests)}</td>
                  <td className="text-right tabular-nums text-zinc-400">{fmt(y.issues)}</td>
                  <td className="text-right tabular-nums">{fmt(y.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Where you contribute</h2>
          <ul className="space-y-1.5 text-sm">
            {me.topRepos.map((r) => (
              <li key={r.repo} className="flex items-center gap-2">
                {r.own ? (
                  <Link href={`/repo/${r.repo}`} className="min-w-0 flex-1 truncate hover:text-accent">
                    {r.repo.split("/")[1]}
                  </Link>
                ) : (
                  <a href={`https://github.com/${r.repo}`} target="_blank" className="min-w-0 flex-1 truncate hover:text-accent">
                    {r.repo}
                  </a>
                )}
                {!r.own && <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">external</span>}
                <span className="w-24 text-right text-xs tabular-nums text-zinc-500">{fmt(r.commits)} commits</span>
                <span className="w-14 text-right text-xs tabular-nums text-zinc-500">{fmt(r.pullRequests)} PRs</span>
              </li>
            ))}
          </ul>
          {!me.topRepos.length && <p className="text-sm text-zinc-500">No commits or pull requests yet.</p>}
        </section>
      </div>

      <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Followers</h2>
        <TimeSeriesChart
          data={followers.history}
          emptyText="Follower history builds up from daily syncs."
          series={[
            { key: "followers", label: "Followers", color: "#2f81f7" },
            { key: "following", label: "Following", color: "#a1a1aa", dashed: true },
          ]}
        />
      </section>
    </div>
  );
}
