import Link from "next/link";
import { notFound } from "next/navigation";
import { TimeSeriesChart } from "@/components/charts";
import { RangePicker } from "@/components/RangePicker";
import { SetupNotice } from "@/components/SetupNotice";
import { StatCard } from "@/components/StatCard";
import { isDbConfigured } from "@/lib/db";
import { fetchCommitActivity, fetchLanguages } from "@/lib/github";
import { getRepoDetail } from "@/lib/queries";
import { fmt, parseRange } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ owner: string; name: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
};

export default async function RepoPage({ params, searchParams }: Props) {
  if (!isDbConfigured()) return <SetupNotice />;
  const { owner, name } = await params;
  const range = parseRange((await searchParams).range);
  const data = await getRepoDetail(owner, name, range);
  if (!data) notFound();

  // Live (not stored) extras; failures shouldn't break the page.
  const [languages, commits] = await Promise.all([
    fetchLanguages(owner, name).catch(() => ({}) as Record<string, number>),
    fetchCommitActivity(owner, name).catch(() => []),
  ]);
  const langTotal = Object.values(languages).reduce((a, b) => a + b, 0);
  const commitWeeks = commits.map((w) => ({ date: new Date(w.week * 1000).toISOString().slice(0, 10), commits: w.total }));

  const first = data.snapshots[0];
  const last = data.snapshots.at(-1);
  const { repo, totals } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/?range=${range}`} className="text-sm text-zinc-500 hover:text-zinc-300">
            ← All repositories
          </Link>
          <h1 className="text-2xl font-semibold">
            <a href={repo.htmlUrl} target="_blank" className="hover:text-accent">
              {repo.fullName}
            </a>
          </h1>
          {repo.description && <p className="text-sm text-zinc-400">{repo.description}</p>}
        </div>
        <RangePicker current={range} basePath={`/repo/${repo.fullName}`} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Views" value={totals.views} sub={`last ${range}d`} />
        <StatCard label="Unique visitors" value={totals.viewUniques} sub="sum of daily uniques" />
        <StatCard label="Clones" value={totals.clones} sub={`last ${range}d`} />
        <StatCard label="Unique cloners" value={totals.cloneUniques} sub="sum of daily uniques" />
        <StatCard label="Stars" value={last?.stars ?? 0} delta={first && last ? last.stars - first.stars : 0} sub={`in ${range}d`} />
        <StatCard label="Forks" value={last?.forks ?? 0} delta={first && last ? last.forks - first.forks : 0} sub={`in ${range}d`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Views</h2>
          <TimeSeriesChart
            data={data.daily}
            series={[
              { key: "views", label: "Views", color: "#2f81f7" },
              { key: "viewUniques", label: "Unique", color: "#2f81f7", dashed: true },
            ]}
          />
        </section>
        <section className="rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Clones</h2>
          <TimeSeriesChart
            data={data.daily}
            series={[
              { key: "clones", label: "Clones", color: "#3fb950" },
              { key: "cloneUniques", label: "Unique", color: "#3fb950", dashed: true },
            ]}
          />
        </section>
        <section className="rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Stars & forks</h2>
          <TimeSeriesChart
            data={data.snapshots}
            series={[
              { key: "stars", label: "Stars", color: "#d29922" },
              { key: "forks", label: "Forks", color: "#a371f7" },
            ]}
          />
        </section>
        <section className="rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Commits per week (last year)</h2>
          <TimeSeriesChart data={commitWeeks} area series={[{ key: "commits", label: "Commits", color: "#db61a2" }]} />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Table
          title="Referrers (last 14d)"
          rows={data.referrers.map((r) => [r.referrer, r.count, r.uniques])}
          headers={["Source", "Views", "Unique"]}
        />
        <Table
          title="Popular content (last 14d)"
          rows={data.paths.map((p) => [p.path.replace(`/${repo.fullName}`, "") || "/", p.count, p.uniques])}
          headers={["Path", "Views", "Unique"]}
        />
        <section className="rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Languages</h2>
          {langTotal ? (
            <ul className="space-y-2 text-sm">
              {Object.entries(languages).map(([lang, bytes]) => (
                <li key={lang}>
                  <div className="flex justify-between">
                    <span>{lang}</span>
                    <span className="text-zinc-400">{((bytes / langTotal) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-zinc-800">
                    <div className="h-1.5 rounded bg-accent" style={{ width: `${(bytes / langTotal) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No language data.</p>
          )}
        </section>
      </div>

      {data.assets.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Table
            title="Release downloads (cumulative)"
            rows={data.assets.map((a) => [`${a.releaseTag} · ${a.assetName}`, a.downloads])}
            headers={["Asset", "Downloads"]}
          />
          <section className="rounded-xl border border-zinc-800 p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-400">Total downloads over time</h2>
            <TimeSeriesChart data={data.downloadsByDay} series={[{ key: "downloads", label: "Downloads", color: "#3fb950" }]} />
          </section>
        </div>
      )}
    </div>
  );
}

function Table({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <section className="rounded-xl border border-zinc-800 p-4">
      <h2 className="mb-3 text-sm font-medium text-zinc-400">{title}</h2>
      {rows.length ? (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              {headers.map((h, i) => (
                <th key={h} className={`pb-2 ${i ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-zinc-800/70">
                {r.map((c, j) => (
                  <td key={j} className={`py-1.5 ${j ? "text-right tabular-nums text-zinc-300" : "max-w-[14rem] truncate"}`}>
                    {typeof c === "number" ? fmt(c) : c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-zinc-500">Nothing yet.</p>
      )}
    </section>
  );
}
