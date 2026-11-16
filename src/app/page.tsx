import Link from "next/link";
import { CiPanel, IssueFlowPanel, SecurityCounts } from "@/components/Activity";
import { FrameworksPanel } from "@/components/Frameworks";
import { LocalTime } from "@/components/LocalTime";
import { TimeSeriesChart } from "@/components/charts";
import { RangePicker } from "@/components/RangePicker";
import { RepoTable } from "@/components/RepoTable";
import { SetupNotice } from "@/components/SetupNotice";
import { Sparkline } from "@/components/Sparkline";
import { StatCard } from "@/components/StatCard";
import { LanguageBars } from "@/components/LanguageBars";
import { isDbConfigured } from "@/lib/db";
import { getOverview } from "@/lib/queries";
import { topWithOther } from "@/lib/transform";
import { fmt, parseRange, rangeParam, rangeText } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  if (!isDbConfigured()) return <SetupNotice />;
  const params = await searchParams;
  const range = parseRange(params.range);
  const q = typeof params.q === "string" ? params.q : "";
  const data = await getOverview(range);
  if (!data.repos.length) return <SetupNotice />;
  const { totals, previous, code } = data;
  const rt = rangeText(range);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">All repositories</h1>
          <p className="text-sm text-zinc-500">
            Last sync: {data.lastRun?.finishedAt ? <LocalTime iso={new Date(data.lastRun.finishedAt).toISOString()} /> : "never"}
            {range === 0 && <> · history since {data.since}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu range={range} />
          <RangePicker current={range} basePath="/" />
        </div>
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
        <StatCard
          label="Clones"
          value={totals.clones}
          previous={previous?.clones}
          sub={rt}
          note={data.automatedClones ? `🤖 ${fmt(data.automatedClones)} likely automated` : undefined}
        />
        <StatCard
          label="Unique cloners"
          value={totals.cloneUniques}
          previous={previous?.cloneUniques}
          sub="Σ daily uniques"
          note={data.window14 ? `${fmt(data.window14.cloneUniques)} distinct · last 14d` : undefined}
        />
        <StatCard label="Stars" value={totals.stars} delta={totals.starsDelta} sub={rt} />
        <StatCard label="Forks" value={totals.forks} delta={totals.forksDelta} sub={rt} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Daily traffic, all repos</h2>
          <TimeSeriesChart
            data={data.daily}
            area
            markers={data.markers}
            series={[
              { key: "views", label: "Views", color: "#2f81f7" },
              { key: "viewUniques", label: "Visitors", color: "#a371f7" },
              { key: "clones", label: "Clones", color: "#3fb950" },
            ]}
          />
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Top referrers (last 14d)</h2>
          {data.topReferrers.length ? (
            <ul className="space-y-2 text-sm">
              {data.topReferrers.map((r) => (
                <li key={r.referrer} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{r.referrer}</span>
                  <Sparkline values={r.trend} width={56} height={16} color="#a371f7" />
                  <span className="w-12 text-right tabular-nums text-zinc-400">{fmt(r.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No referrers yet.</p>
          )}
        </section>
      </div>

      {data.recentAlerts.length > 0 && (
        <section className="rounded-xl border border-amber-900/50 bg-amber-950/10 p-4">
          <h2 className="mb-2 text-sm font-medium text-amber-300">⚡ Recent alerts</h2>
          <ul className="space-y-1 text-sm">
            {data.recentAlerts.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span className="w-24 shrink-0 text-xs tabular-nums text-zinc-500">{a.date}</span>
                <Link href={`/repo/${a.fullName}?range=${rangeParam(range)}`} className="min-w-0 truncate hover:text-accent">
                  {a.message}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Languages across your repos</h2>
          <p className="mb-3 text-xs text-zinc-500">Share of code by bytes (GitHub Linguist) · forks excluded</p>
          {code.languages.length ? (
            <LanguageBars items={topWithOther(code.languages, 10)} />
          ) : (
            <p className="text-sm text-zinc-500">Language totals appear after the next sync.</p>
          )}
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Lines of code</h2>
          {code.reposWithLines ? (
            <>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(code.linesOfCode)}</div>
              <p className="mb-3 text-xs text-zinc-500">
                non-blank lines on default branches · {code.reposWithLines} of {code.reposCounted} repos · forks excluded ·
                lock files, vendored, generated, minified and non-code files (Markdown, JSON, YAML) left out
              </p>
              {code.linesByLanguage.length > 0 && (
                <div className="mb-4">
                  <LanguageBars items={topWithOther(code.linesByLanguage, 6)} unit="lines" />
                </div>
              )}
              <h3 className="mb-1.5 text-xs font-medium text-zinc-500">Largest repos</h3>
              <ul className="space-y-1.5 text-sm">
                {code.largest.map((r) => (
                  <li key={r.fullName} className="flex items-center gap-2">
                    <Link href={`/repo/${r.fullName}?range=${rangeParam(range)}`} className="min-w-0 flex-1 truncate hover:text-accent">
                      {r.name}
                    </Link>
                    {r.language && <span className="text-xs text-zinc-500">{r.language}</span>}
                    <span className="w-16 text-right tabular-nums text-zinc-400">{fmt(r.linesOfCode)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">Line counts appear after the next sync.</p>
          )}
        </section>
      </div>

      <FrameworksPanel groups={code.frameworks} range={rangeParam(range)} reposCounted={code.reposCounted} />

      {data.activity.synced ? (
        <>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <IssueFlowPanel
              flow={data.activity.flow}
              weekly={data.activity.weekly}
              rangeLabel={`${rt} · your repos, forks and archived excluded`}
              unavailable={data.activity.issuesUnavailable}
            />
            <CiPanel ci={data.activity.ci} range={rangeParam(range)} showRepo />
          </div>
          {data.activity.security && (
            <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium text-zinc-400">Open Dependabot alerts</h2>
                <span className="text-xs text-zinc-500">{data.activity.security.reposChecked} repos checked</span>
              </div>
              <SecurityCounts counts={data.activity.security} />
              {data.activity.security.repos.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {data.activity.security.repos.map((r) => (
                    <li key={r.fullName}>
                      <Link href={`/repo/${r.fullName}?range=${rangeParam(range)}`} className="hover:text-accent">
                        {r.name}
                      </Link>{" "}
                      <span className="tabular-nums text-xs text-red-400">{r.alerts}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      ) : (
        <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">
          Issues, pull requests, CI and community health appear after the next sync.
        </p>
      )}

      <RepoTable key={q} repos={data.repos} range={range} initialQuery={q} />
    </div>
  );
}

function ExportMenu({ range }: { range: number }) {
  const r = rangeParam(range);
  const cls = "rounded-md border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-600 hover:text-white";
  return (
    <div className="flex gap-1">
      <a className={cls} href={`/api/export?kind=repos&range=${r}`}>
        ⬇ Repos CSV
      </a>
      <a className={cls} href={`/api/export?kind=daily&range=${r}`}>
        ⬇ Daily CSV
      </a>
    </div>
  );
}
