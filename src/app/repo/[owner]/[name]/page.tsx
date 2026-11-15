import Link from "next/link";
import { notFound } from "next/navigation";
import { TimeSeriesChart } from "@/components/charts";
import { RangePicker } from "@/components/RangePicker";
import { SetupNotice } from "@/components/SetupNotice";
import { StatCard } from "@/components/StatCard";
import { isDbConfigured } from "@/lib/db";
import { getCommitActivity, getLanguages } from "@/lib/github-cached";
import { getRepoDetail } from "@/lib/queries";
import { fmt, parseRange, rangeParam, rangeText } from "@/lib/utils";

export const dynamic = "force-dynamic";

const REFERRER_COLORS = ["#2f81f7", "#a371f7", "#3fb950", "#d29922", "#db61a2"];

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

  // Live (not stored) extras, cached; failures shouldn't break the page.
  const [languages, commits] = await Promise.all([getLanguages(owner, name), getCommitActivity(owner, name)]);
  const langTotal = Object.values(languages).reduce((a, b) => a + b, 0);
  const commitWeeks = commits.map((w) => ({ date: new Date(w.week * 1000).toISOString().slice(0, 10), commits: w.total }));

  const { repo, totals, previous } = data;
  const rt = rangeText(range);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/?range=${rangeParam(range)}`} className="text-sm text-zinc-500 hover:text-zinc-300">
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
        <StatCard label="Views" value={totals.views} previous={previous?.views} sub={rt} />
        <StatCard
          label="Unique visitors"
          value={totals.viewUniques}
          previous={previous?.viewUniques}
          sub="Σ daily uniques"
          note={data.window14 ? `${fmt(data.window14.viewUniques)} distinct · last 14d` : undefined}
        />
        <StatCard label="Clones" value={totals.clones} previous={previous?.clones} sub={rt} />
        <StatCard
          label="Unique cloners"
          value={totals.cloneUniques}
          previous={previous?.cloneUniques}
          sub="Σ daily uniques"
          note={data.window14 ? `${fmt(data.window14.cloneUniques)} distinct · last 14d` : undefined}
        />
        <StatCard label="Stars" value={data.current.stars} delta={data.starsGained} sub={rt} />
        <StatCard label="Forks" value={data.current.forks} delta={data.forksGained} sub={rt} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Views</h2>
          <TimeSeriesChart
            data={data.daily}
            series={[
              { key: "views", label: "Views", color: "#2f81f7" },
              { key: "viewUniques", label: "Unique", color: "#2f81f7", dashed: true },
            ]}
          />
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Clones</h2>
          <TimeSeriesChart
            data={data.daily}
            series={[
              { key: "clones", label: "Clones", color: "#3fb950" },
              { key: "cloneUniques", label: "Unique", color: "#3fb950", dashed: true },
            ]}
          />
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Stars & forks over time</h2>
          <TimeSeriesChart
            data={data.growth}
            series={[
              { key: "stars", label: "Stars", color: "#d29922" },
              { key: "forks", label: "Forks", color: "#a371f7" },
            ]}
          />
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Commits per week (last year)</h2>
          <TimeSeriesChart
            data={commitWeeks}
            area
            emptyText="GitHub is still computing commit stats (or GITHUB_TOKEN is missing) — try again shortly."
            series={[{ key: "commits", label: "Commits", color: "#db61a2" }]} />
        </section>
      </div>

      {data.referrerTrend.data.length > 1 && (
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-1 text-sm font-medium text-zinc-400">Referrer trend</h2>
          <p className="mb-3 text-xs text-zinc-500">Each point is GitHub&apos;s rolling 14-day view count for that source, as of that day.</p>
          <TimeSeriesChart
            data={data.referrerTrend.data}
            series={data.referrerTrend.series.map((s, i) => ({ ...s, color: REFERRER_COLORS[i % REFERRER_COLORS.length] }))}
          />
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
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
            <p className="text-sm text-zinc-500">No language data (fetched live — needs GITHUB_TOKEN).</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PeopleList
          title="Recent stargazers"
          empty="No stargazers yet."
          items={data.recentStargazers.map((s) => ({ key: s.login, login: s.login, href: `https://github.com/${s.login}`, at: s.starredAt }))}
        />
        <PeopleList
          title="Recent forks"
          empty="No forks yet."
          items={data.recentForks.map((f) => ({
            key: String(f.forkId),
            login: f.owner,
            label: f.fullName,
            href: `https://github.com/${f.fullName}`,
            at: f.createdAt,
            extra: f.stars ? `★ ${fmt(f.stars)}` : undefined,
          }))}
        />
      </div>

      {data.assets.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Table
            title="Release downloads (cumulative)"
            rows={data.assets.map((a) => [`${a.releaseTag} · ${a.assetName}`, a.downloads])}
            headers={["Asset", "Downloads"]}
          />
          <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
            <h2 className="mb-3 text-sm font-medium text-zinc-400">Total downloads over time</h2>
            <TimeSeriesChart data={data.downloadsByDay} series={[{ key: "downloads", label: "Downloads", color: "#3fb950" }]} />
          </section>
        </div>
      )}
    </div>
  );
}

function PeopleList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { key: string; login: string; label?: string; href: string; at: Date; extra?: string }[];
}) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
      <h2 className="mb-3 text-sm font-medium text-zinc-400">{title}</h2>
      {items.length ? (
        <ul className="space-y-2 text-sm">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`https://github.com/${i.login}.png?size=40`} alt="" width={20} height={20} className="rounded-full" />
              <a href={i.href} target="_blank" className="truncate hover:text-accent">
                {i.label ?? i.login}
              </a>
              {i.extra && <span className="text-xs text-zinc-500">{i.extra}</span>}
              <span className="ml-auto shrink-0 text-xs text-zinc-500">{new Date(i.at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">{empty}</p>
      )}
    </section>
  );
}

function Table({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
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
