import Link from "next/link";
import type { ciStats, issueFlow } from "@/lib/transform";
import { shortDuration } from "@/lib/transform";
import { fmt } from "@/lib/utils";
import { TimeSeriesChart } from "./charts";
import { pct, rateColor } from "./format";

type Flow = ReturnType<typeof issueFlow>;
type Ci = ReturnType<typeof ciStats>;

const secs = (s: number | null) => (s === null ? "—" : s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export function IssueFlowPanel({
  flow,
  weekly,
  rangeLabel,
  unavailable = 0,
  single = false,
}: {
  flow: Flow;
  weekly: { date: string; opened: number; closed: number }[];
  rangeLabel: string;
  /** Repos the token can't read issues for */
  unavailable?: number;
  /** One repo's page: say so plainly instead of counting repos */
  single?: boolean;
}) {
  const permission = (
    <>
      add <b>Issues: Read-only</b> and <b>Pull requests: Read-only</b> to your token (needed for private repos)
    </>
  );
  if (single && unavailable) {
    return (
      <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
        <h2 className="text-sm font-medium text-zinc-400">Issues &amp; pull requests</h2>
        <p className="mt-2 text-sm text-zinc-500">The token can&apos;t read this repo&apos;s issues — {permission}.</p>
      </section>
    );
  }
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-400">Issues &amp; pull requests</h2>
      <p className="mb-3 text-xs text-zinc-500">{rangeLabel} · open counts are current</p>
      {unavailable > 0 && (
        <p className="mb-3 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
          {unavailable} repo{unavailable === 1 ? "" : "s"} left out — {permission}.
        </p>
      )}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Kpi label="Issues opened / closed" value={`${fmt(flow.issuesOpened)} / ${fmt(flow.issuesClosed)}`} sub={`${fmt(flow.openIssues)} open now`} />
        <Kpi label="PRs opened / merged" value={`${fmt(flow.prsOpened)} / ${fmt(flow.prsMerged)}`} sub={`${fmt(flow.openPrs)} open now`} />
        <Kpi label="From outside" value={fmt(flow.outsideItems)} sub={`${fmt(flow.outsideContributors.length)} people · bots excluded`} />
        <Kpi label="Median time to close" value={shortDuration(flow.medianHoursToClose)} sub="issues" />
        <Kpi label="Median time to merge" value={shortDuration(flow.medianHoursToMerge)} sub="pull requests" />
        <Kpi label="Closed unmerged" value={fmt(flow.prsClosedUnmerged)} sub={flow.botItems ? `${fmt(flow.botItems)} by bots` : "pull requests"} />
      </div>
      <TimeSeriesChart
        data={weekly}
        height={160}
        emptyText="No issues or pull requests in this range."
        series={[
          { key: "opened", label: "Opened", color: "#2f81f7" },
          { key: "closed", label: "Closed", color: "#a371f7", dashed: true },
        ]}
      />
      {flow.outsideContributors.length > 0 && (
        <p className="mt-3 text-xs text-zinc-500">
          Outside contributors:{" "}
          {flow.outsideContributors.slice(0, 8).map((c, i) => (
            <span key={c.login}>
              {i > 0 && ", "}
              <a href={`https://github.com/${c.login}`} target="_blank" className="text-zinc-300 hover:text-accent">
                {c.login}
              </a>{" "}
              ({c.count})
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export function CiPanel({ ci, range, showRepo = false }: { ci: Ci | null; range: string; showRepo?: boolean }) {
  return (
    <section className="min-w-0 rounded-xl border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-400">GitHub Actions</h2>
      {!ci ? (
        <p className="mt-2 text-sm text-zinc-500">
          Add the <b>Actions: Read-only</b> permission to your token to see CI pass rates and build times.
        </p>
      ) : !ci.runs ? (
        <p className="mt-2 text-sm text-zinc-500">No workflow runs in this range.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-zinc-500">pass rate leaves out cancelled and skipped runs · duration = start to finish</p>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Kpi label="Pass rate" value={pct(ci.passRate)} sub={`${fmt(ci.passed)} passed · ${fmt(ci.failed)} failed`} />
            <Kpi label="Runs" value={fmt(ci.runs)} />
            <Kpi label="Median duration" value={secs(ci.medianSeconds)} />
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-1.5 text-left font-normal">Workflow</th>
                <th className="pb-1.5 text-right font-normal">Runs</th>
                <th className="pb-1.5 text-right font-normal">Pass</th>
                <th className="pb-1.5 text-right font-normal">Median</th>
                <th className="pb-1.5 text-right font-normal">Last</th>
              </tr>
            </thead>
            <tbody>
              {ci.workflows.slice(0, 8).map((w) => (
                <tr key={`${w.repo}/${w.workflow}`} className="border-t border-zinc-800/60">
                  <td className="max-w-0 py-1.5">
                    <div className="truncate">{w.workflow}</div>
                    {showRepo && w.repo && (
                      <Link href={`/repo/${w.repo}?range=${range}`} className="block truncate text-[11px] text-zinc-500 hover:text-accent">
                        {w.repo.split("/")[1]}
                      </Link>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-zinc-400">{fmt(w.runs)}</td>
                  <td className={`text-right tabular-nums ${rateColor(w.passRate)}`}>{pct(w.passRate)}</td>
                  <td className="text-right tabular-nums text-zinc-400">{secs(w.medianSeconds)}</td>
                  <td className="text-right text-xs">
                    <span className={w.last.conclusion === "success" ? "text-emerald-400" : w.last.conclusion === "failure" ? "text-red-400" : "text-zinc-500"}>
                      {w.last.conclusion.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ci.recentFailures.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-xs font-medium text-zinc-500">Recent failures</h3>
              <ul className="space-y-1 text-xs text-zinc-400">
                {ci.recentFailures.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-20 shrink-0 tabular-nums text-zinc-500">{f.createdAt.toISOString().slice(0, 10)}</span>
                    <span className="min-w-0 truncate">
                      {showRepo && f.repo && (
                        <Link href={`/repo/${f.repo}?range=${range}`} className="hover:text-accent">
                          {f.repo.split("/")[1]} ·{" "}
                        </Link>
                      )}
                      {f.workflow}
                      {f.branch && <span className="text-zinc-600"> on {f.branch}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

const SEVERITY = [
  ["critical", "Critical", "bg-red-500"],
  ["high", "High", "bg-orange-500"],
  ["medium", "Medium", "bg-amber-400"],
  ["low", "Low", "bg-zinc-400"],
] as const;

export function SecurityCounts({ counts }: { counts: { critical: number; high: number; medium: number; low: number } }) {
  return (
    <div className="flex flex-wrap gap-4">
      {SEVERITY.map(([k, label, dot]) => (
        <div key={k} className="flex items-center gap-1.5 text-sm">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="tabular-nums">{fmt(counts[k])}</span>
          <span className="text-xs text-zinc-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

type Health = {
  healthPercentage: number | null;
  hasReadme: boolean | null;
  hasDescription: boolean | null;
  hasLicense: boolean | null;
  hasContributing: boolean | null;
  hasCodeOfConduct: boolean | null;
  hasIssueTemplate: boolean | null;
  hasPrTemplate: boolean | null;
};

/** GitHub's community profile as a checklist. */
export function HealthChecklist({ health }: { health: Health }) {
  const items: [string, boolean | null][] = [
    ["Description", health.hasDescription],
    ["README", health.hasReadme],
    ["License", health.hasLicense],
    ["Contributing guide", health.hasContributing],
    ["Code of conduct", health.hasCodeOfConduct],
    ["Issue template", health.hasIssueTemplate],
    ["Pull request template", health.hasPrTemplate],
  ];
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {items.map(([label, ok]) => (
        <li key={label} className={ok ? "text-zinc-300" : "text-zinc-500"}>
          <span className={ok ? "text-emerald-400" : "text-zinc-600"}>{ok ? "✓" : "○"}</span> {label}
        </li>
      ))}
    </ul>
  );
}
