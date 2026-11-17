import Link from "next/link";
import { notFound } from "next/navigation";
import { CiPanel, HealthChecklist, IssueFlowPanel, SecurityCounts } from "@/components/Activity";
import { TimeSeriesChart } from "@/components/charts";
import { FrameworkTags } from "@/components/Frameworks";
import { DeploysPanel } from "@/components/CodeHealth";
import { healthColor } from "@/components/format";
import { RangePicker } from "@/components/RangePicker";
import { SetupNotice } from "@/components/SetupNotice";
import { LanguageBars } from "@/components/LanguageBars";
import { StatCard } from "@/components/StatCard";
import { isDbConfigured } from "@/lib/db";
import { addNote, deleteNote, saveAlertSettings } from "./actions";
import { AlertSettingsForm } from "@/components/AlertSettingsForm";
import { getCodeFrequency, getCommitActivity, getLanguages } from "@/lib/github-cached";
import { getRepoDetail } from "@/lib/queries";
import { getScope } from "@/lib/scope";
import { monthlyCodeFrequency } from "@/lib/transform";
import { fmt, isoDay, parseRange, rangeParam, rangeText } from "@/lib/utils";

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
  // Unknown repos and other users' repos both 404 (no hint that a private repo exists)
  const data = await getRepoDetail(owner, name, range, await getScope());
  if (!data) notFound();

  // Live (not stored) extras, cached; failures shouldn't break the page.
  // Languages are stored by the sync; until it has run for this repo, fall back to a live fetch.
  const [liveLanguages, commits, codeFrequency] = await Promise.all([
    data.languages.length ? Promise.resolve(null) : getLanguages(owner, name, data.repo.installationId),
    getCommitActivity(owner, name, data.repo.installationId),
    getCodeFrequency(owner, name, data.repo.installationId),
  ]);
  const codeMonths = monthlyCodeFrequency(codeFrequency);
  const languages = liveLanguages
    ? Object.entries(liveLanguages).map(([language, bytes]) => ({ language, bytes }))
    : data.languages;
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

      {data.likelyAutomated && (
        <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-300">
          🤖 <span className="font-medium">Clones look mostly automated:</span> {fmt(totals.clones)} clones vs {fmt(totals.views)}{" "}
          views ({rt}). That pattern usually means CI runs, mirrors or deploy hosts (Vercel and Netlify clone on every
          build) rather than people. It&apos;s a guess: GitHub doesn&apos;t report who cloned.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Views</h2>
          <TimeSeriesChart
            data={data.daily}
            markers={data.markers}
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
            markers={data.markers}
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Code growth</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Lines added and deleted per month over the repo&apos;s whole history (all files, lock files included) — GitHub
            doesn&apos;t compute this for repos with 10,000+ commits
          </p>
          <TimeSeriesChart
            data={codeMonths}
            monthly
            emptyText="GitHub is still computing code stats (or this repo has 10,000+ commits) — try again shortly."
            series={[
              { key: "additions", label: "Added", color: "#3fb950" },
              { key: "deletions", label: "Deleted", color: "#f85149" },
            ]}
          />
          {data.codeHistory.length > 1 && (
            <>
              <h3 className="mb-1.5 mt-4 text-xs font-medium text-zinc-500">Lines of code counted by the sync</h3>
              <TimeSeriesChart
                data={data.codeHistory}
                height={120}
                series={[
                  { key: "lines", label: "Lines", color: "#2f81f7" },
                  { key: "tests", label: "Test lines", color: "#3fb950", dashed: true },
                ]}
              />
            </>
          )}
        </section>
        <DeploysPanel deploys={data.deploys} permissionMissing={data.deployPermissionMissing} showRepos={false} />
      </div>

      {data.activity.synced && <ActivitySections activity={data.activity} range={rangeParam(range)} rangeLabel={rt} fullName={data.repo.fullName} />}

      <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Notes &amp; alerts</h2>
        <form action={addNote} className="mb-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="repo" value={repo.fullName} />
          <input
            type="date"
            name="date"
            defaultValue={isoDay()}
            required
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm [color-scheme:dark]"
          />
          <input
            name="label"
            required
            maxLength={120}
            placeholder='e.g. "Posted on Hacker News"'
            className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <button className="rounded-md bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700">Add note</button>
        </form>
        {data.notes.length || data.alerts.length || data.releases.length ? (
          <ul className="space-y-1.5 text-sm">
            {[
              ...data.notes.map((n) => ({ key: `n${n.id}`, date: n.date, text: n.label, note: n, kind: "note" as const, url: null })),
              ...data.alerts.map((a) => ({ key: `a${a.id}`, date: a.date, text: a.message, note: null, kind: "alert" as const, url: null })),
              ...data.releases.map((r) => ({
                key: `r${r.tag}`,
                date: isoDay(r.publishedAt),
                text: `Released ${r.tag}${r.name && r.name !== r.tag ? ` — ${r.name}` : ""}${r.prerelease ? " (pre-release)" : ""}`,
                note: null,
                kind: "release" as const,
                url: r.url,
              })),
            ]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((item) => (
                <li key={item.key} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-zinc-500">{item.date}</span>
                  <span className={item.kind === "note" ? "text-zinc-200" : item.kind === "release" ? "text-emerald-400" : "text-amber-300"}>
                    {item.kind === "note" ? "📝" : item.kind === "release" ? "🚀" : "⚡"}
                  </span>
                  {item.url ? (
                    <a href={item.url} target="_blank" className="min-w-0 flex-1 truncate hover:text-accent">
                      {item.text}
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{item.text}</span>
                  )}
                  {item.note && (
                    <form action={deleteNote}>
                      <input type="hidden" name="id" value={item.note.id} />
                      <input type="hidden" name="repo" value={repo.fullName} />
                      <button className="text-xs text-zinc-500 hover:text-rose-400" aria-label="Delete note">
                        ✕
                      </button>
                    </form>
                  )}
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">
            No notes yet. Add one to mark launches or posts on the charts — releases, traffic spikes and star milestones
            appear here automatically.
          </p>
        )}
        <AlertSettingsForm
          fullName={repo.fullName}
          override={data.alertSettings.override}
          defaults={data.alertSettings.defaults}
          action={saveAlertSettings}
        />
      </section>

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
          <h2 className="text-sm font-medium text-zinc-400">Code</h2>
          <FrameworkTags frameworks={data.frameworks} />
          <p
            className="mb-3 text-xs text-zinc-500"
            title="Non-blank lines on the default branch. Lock files, vendored and build directories, generated and minified files, and non-code files (Markdown, JSON, YAML) are left out; .gitattributes linguist-* rules are honoured."
          >
            {repo.linesOfCode !== null
              ? `${fmt(repo.linesOfCode)} lines of code${repo.testLines !== null && repo.linesOfCode ? ` · ${Math.round((repo.testLines / repo.linesOfCode) * 100)}% tests` : ""}${repo.todoCount ? ` · ${fmt(repo.todoCount)} TODO/FIXME` : ""}${repo.locCommitSha && repo.locCommitSha !== "demo" ? ` · at ${repo.locCommitSha.slice(0, 7)}` : ""}`
              : repo.codeStatsPushedAt
                ? "Line count skipped (repository larger than 500 MB)"
                : "Line count appears after the next sync"}
          </p>
          {data.loc.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-1.5 text-xs font-medium text-zinc-500">Lines by language</h3>
              <LanguageBars items={data.loc.map((l) => ({ language: l.language, bytes: l.nonBlank }))} unit="lines" />
            </div>
          )}
          {languages.length ? (
            <>
              {data.loc.length > 0 && <h3 className="mb-1.5 text-xs font-medium text-zinc-500">Bytes by language (GitHub)</h3>}
              <LanguageBars items={languages} />
            </>
          ) : (
            <p className="text-sm text-zinc-500">No language data yet.</p>
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
              <span className="ml-auto shrink-0 text-xs text-zinc-500">{new Date(i.at).toLocaleDateString("en-US", { timeZone: "UTC" })}</span>
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

type RepoActivity = NonNullable<Awaited<ReturnType<typeof getRepoDetail>>>["activity"];

function ActivitySections({ activity, range, rangeLabel, fullName }: { activity: RepoActivity; range: string; rangeLabel: string; fullName: string }) {
  const h = activity.health;
  const security =
    h && h.dependabotHigh !== null
      ? { critical: h.dependabotCritical ?? 0, high: h.dependabotHigh ?? 0, medium: h.dependabotMedium ?? 0, low: h.dependabotLow ?? 0 }
      : null;
  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <IssueFlowPanel flow={activity.flow} weekly={activity.weekly} rangeLabel={rangeLabel} unavailable={activity.issuesUnavailable} single />
        <CiPanel ci={activity.ci} range={range} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-zinc-400">Community health</h2>
            {h?.healthPercentage !== null && h?.healthPercentage !== undefined && (
              <span className={`text-lg font-semibold tabular-nums ${healthColor(h.healthPercentage)}`}>{h.healthPercentage}%</span>
            )}
          </div>
          {h && h.healthPercentage !== null ? (
            <HealthChecklist health={h} />
          ) : (
            <p className="text-sm text-zinc-500">GitHub only reports community health for public repositories.</p>
          )}
          <h3 className="mb-2 mt-4 text-xs font-medium text-zinc-500">Open Dependabot alerts</h3>
          {security ? (
            <SecurityCounts counts={security} />
          ) : (
            <p className="text-sm text-zinc-500">
              Unavailable — Dependabot alerts are off for this repo, or the token lacks <b>Dependabot alerts: Read-only</b>.
            </p>
          )}
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Open issues &amp; pull requests</h2>
          {activity.open.length ? (
            <ul className="space-y-1.5 text-sm">
              {activity.open.map((i) => (
                <li key={i.number} className="flex items-center gap-2">
                  <span className={`w-6 shrink-0 text-xs ${i.isPr ? "text-violet-400" : "text-emerald-400"}`}>{i.isPr ? "PR" : "●"}</span>
                  <a href={`https://github.com/${fullName}/${i.isPr ? "pull" : "issues"}/${i.number}`} target="_blank" className="min-w-0 flex-1 truncate hover:text-accent">
                    {i.title}
                  </a>
                  {i.outside && <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">outside</span>}
                  {i.isBot && <span className="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-500">bot</span>}
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500">{i.createdAt.toISOString().slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">Nothing open. 🎉</p>
          )}
        </section>
      </div>
    </>
  );
}
