import { TimeSeriesChart } from "@/components/charts";
import { RangePicker } from "@/components/RangePicker";
import { RepoTable } from "@/components/RepoTable";
import { SetupNotice } from "@/components/SetupNotice";
import { StatCard } from "@/components/StatCard";
import { isDbConfigured } from "@/lib/db";
import { getOverview } from "@/lib/queries";
import { fmt, parseRange } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  if (!isDbConfigured()) return <SetupNotice />;
  const range = parseRange((await searchParams).range);
  const data = await getOverview(range);
  if (!data.repos.length) return <SetupNotice />;
  const { totals } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">All repositories</h1>
          <p className="text-sm text-zinc-500">
            Last sync: {data.lastRun?.finishedAt ? new Date(data.lastRun.finishedAt).toLocaleString() : "never"}
          </p>
        </div>
        <RangePicker current={range} basePath="/" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Views" value={totals.views} sub={`last ${range}d`} />
        <StatCard label="Unique visitors" value={totals.viewUniques} sub="sum of daily uniques" />
        <StatCard label="Clones" value={totals.clones} sub={`last ${range}d`} />
        <StatCard label="Unique cloners" value={totals.cloneUniques} sub="sum of daily uniques" />
        <StatCard label="Stars" value={totals.stars} delta={totals.starsDelta} sub={`in ${range}d`} />
        <StatCard label="Forks" value={totals.forks} delta={totals.forksDelta} sub={`in ${range}d`} />
      </div>

      <section className="rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Daily traffic, all repos</h2>
        <TimeSeriesChart
          data={data.daily}
          area
          series={[
            { key: "views", label: "Views", color: "#2f81f7" },
            { key: "viewUniques", label: "Visitors", color: "#a371f7" },
            { key: "clones", label: "Clones", color: "#3fb950" },
          ]}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <RepoTable repos={data.repos} range={range} />
        <section className="rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Top referrers (last 14d)</h2>
          {data.topReferrers.length ? (
            <ul className="space-y-2 text-sm">
              {data.topReferrers.map((r) => (
                <li key={r.referrer} className="flex justify-between gap-2">
                  <span className="truncate">{r.referrer}</span>
                  <span className="tabular-nums text-zinc-400">{fmt(r.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No referrers yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
