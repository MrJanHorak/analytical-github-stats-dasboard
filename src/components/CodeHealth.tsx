import Link from "next/link";
import type { deployStats, outdatedFrameworks } from "@/lib/transform";
import { fmt } from "@/lib/utils";
import { TimeSeriesChart } from "./charts";
import { pct, rateColor } from "./format";

type Health = { testLines: number; testRatio: number | null; todos: number; reposWithTests: number; reposCounted: number } | null;
type History = { date: string; lines: number; tests: number }[];
type Outdated = ReturnType<typeof outdatedFrameworks>;
type Deploys = ReturnType<typeof deployStats>;

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

const growth = (history: History) => {
  if (history.length < 2) return null;
  const d = history.at(-1)!.lines - history[0].lines;
  return `${d >= 0 ? "+" : ""}${fmt(d)} in range`;
};

/** Overview: test share, TODOs, lines over time and frameworks a major version behind. */
export function CodeHealthPanel({ health, history, outdated, range }: { health: Health; history: History; outdated: Outdated; range: string }) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-400">Code health</h2>
      <p className="mb-3 text-xs text-zinc-500">
        from the line counter · tests = files in test folders or named *.test / *.spec / test_* · forks excluded
      </p>
      {health ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Lines of code" value={fmt(history.at(-1)?.lines ?? 0)} sub={growth(history) ?? "history builds up from now"} />
          <Kpi label="Test code" value={pct(health.testRatio)} sub={`${fmt(health.testLines)} lines`} />
          <Kpi label="Repos with tests" value={`${health.reposWithTests} / ${health.reposCounted}`} />
          <Kpi label="TODO / FIXME" value={fmt(health.todos)} />
        </div>
      ) : (
        <p className="mb-3 text-sm text-zinc-500">Appears after the next sync recounts your repos.</p>
      )}
      <TimeSeriesChart
        data={history}
        height={150}
        emptyText="Lines over time build up from the next sync — one point per day a repo changes."
        series={[
          { key: "lines", label: "Lines", color: "#2f81f7" },
          { key: "tests", label: "Test lines", color: "#3fb950", dashed: true },
        ]}
      />
      <h3 className="mb-1.5 mt-4 text-xs font-medium text-zinc-500">Frameworks a major version behind</h3>
      {outdated.length ? (
        <ul className="space-y-1.5 text-sm">
          {outdated.map((o) => (
            <li key={o.framework} className="flex flex-wrap items-baseline gap-x-2">
              <span>{o.framework}</span>
              <span className="text-xs text-amber-400">latest {o.latest}</span>
              <span className="text-xs text-zinc-500">
                {o.repos.map((r, i) => (
                  <span key={r.repo}>
                    {i > 0 && ", "}
                    <Link href={`/?range=${range}&q=${encodeURIComponent(r.repo)}#repos`} className="hover:text-accent">
                      {r.repo}
                    </Link>{" "}
                    ({r.version})
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">Everything with a pinned version is on the latest major. 🎉</p>
      )}
    </section>
  );
}

/** Deployments reported to GitHub (Vercel, Netlify, Pages, Actions environments). */
export function DeploysPanel({ deploys, permissionMissing, showRepos = true }: { deploys: Deploys | null; permissionMissing: boolean; showRepos?: boolean }) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-400">Deployments</h2>
      {permissionMissing ? (
        <p className="mt-2 text-sm text-zinc-500">
          Add <b>Deployments: Read-only</b> to your token to see how often you ship.
        </p>
      ) : !deploys || !deploys.total ? (
        <p className="mt-2 text-sm text-zinc-500">No deployments reported to GitHub in this range (Vercel, Netlify and GitHub Pages report them).</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500">as reported to GitHub by Vercel, Netlify, GitHub Pages and Actions environments</p>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Kpi label="Production deploys" value={fmt(deploys.production)} sub={`${deploys.productionPerWeek} / week`} />
            <Kpi label="Previews" value={fmt(deploys.preview)} />
            <div>
              <div className="text-xs text-zinc-500">Success rate</div>
              <div className={`text-lg font-semibold tabular-nums ${rateColor(deploys.successRate)}`}>{pct(deploys.successRate)}</div>
              <div className="text-[11px] text-zinc-500">{fmt(deploys.failed)} failed</div>
            </div>
          </div>
          <TimeSeriesChart
            data={deploys.weekly}
            height={130}
            series={[
              { key: "production", label: "Production", color: "#3fb950" },
              { key: "preview", label: "Preview", color: "#a1a1aa", dashed: true },
            ]}
          />
          {showRepos && deploys.byRepo.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {deploys.byRepo.slice(0, 6).map((r) => (
                <li key={r.repo} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{r.repo}</span>
                  <span className="text-xs tabular-nums text-zinc-400">{fmt(r.production)} prod</span>
                  <span className="w-16 text-right text-xs tabular-nums text-zinc-500">{fmt(r.preview)} preview</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
