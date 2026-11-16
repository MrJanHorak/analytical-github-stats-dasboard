"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RepoRow } from "@/lib/queries";
import { fmt, rangeParam } from "@/lib/utils";
import { healthColor, pct, rateColor } from "./format";
import { Sparkline } from "./Sparkline";

type Key =
  | "fullName"
  | "views"
  | "viewUniques"
  | "clones"
  | "cloneUniques"
  | "stars"
  | "forks"
  | "linesOfCode"
  | "health"
  | "ciPassRate"
  | "pushedAt";

const cols: { key: Key; label: string; numeric?: boolean }[] = [
  { key: "fullName", label: "Repository" },
  { key: "views", label: "Trend", numeric: true },
  { key: "views", label: "Views", numeric: true },
  { key: "viewUniques", label: "Visitors", numeric: true },
  { key: "clones", label: "Clones", numeric: true },
  { key: "cloneUniques", label: "Cloners", numeric: true },
  { key: "stars", label: "Stars", numeric: true },
  { key: "forks", label: "Forks", numeric: true },
  { key: "linesOfCode", label: "Lines", numeric: true },
  { key: "health", label: "Health", numeric: true },
  { key: "ciPassRate", label: "CI", numeric: true },
  { key: "pushedAt", label: "Last push" },
];

export function RepoTable({ repos, range, initialQuery = "" }: { repos: RepoRow[]; range: number; initialQuery?: string }) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "views", dir: -1 });
  const [q, setQ] = useState(initialQuery);
  const [hideForks, setHideForks] = useState(true);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Matches the repo name, or a framework/tool it uses ("next.js", "tailwind")
    const filtered = repos.filter(
      (r) =>
        (!hideForks || !r.isFork) &&
        (r.fullName.toLowerCase().includes(needle) || r.frameworks.some((f) => f.toLowerCase().startsWith(needle))),
    );
    return filtered.sort((a, b) => {
      const av = a[sort.key] ?? "";
      const bv = b[sort.key] ?? "";
      return (av > bv ? 1 : av < bv ? -1 : 0) * sort.dir;
    });
  }, [repos, sort, q, hideForks]);

  return (
    <div id="repos" className="scroll-mt-4 rounded-xl border border-zinc-800">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name or framework…"
          className="w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm outline-none focus:border-accent"
        />
        <label className="flex items-center gap-1.5 text-sm text-zinc-400">
          <input type="checkbox" checked={hideForks} onChange={(e) => setHideForks(e.target.checked)} />
          Hide forks
        </label>
        <span className="ml-auto text-xs text-zinc-500">{rows.length} repos</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.label}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                  className={`cursor-pointer select-none px-3 py-2 hover:text-zinc-300 ${c.numeric ? "text-right" : ""}`}
                >
                  {c.label}
                  {sort.key === c.key && c.label !== "Trend" ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800/70 hover:bg-zinc-900/60">
                <td className="px-3 py-2">
                  <Link href={`/repo/${r.fullName}?range=${rangeParam(range)}`} className="font-medium hover:text-accent">
                    {r.name}
                  </Link>
                  {r.isPrivate && <span className="ml-2 rounded border border-zinc-700 px-1 text-[10px] text-zinc-400">private</span>}
                  {(r.securityAlerts ?? 0) > 0 && (
                    <span className="ml-2 rounded border border-red-900 px-1 text-[10px] text-red-400" title="Open Dependabot alerts">
                      {r.securityAlerts} alert{r.securityAlerts === 1 ? "" : "s"}
                    </span>
                  )}
                  {r.description && <div className="max-w-md truncate text-xs text-zinc-500">{r.description}</div>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Sparkline values={r.spark} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(r.views)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{fmt(r.viewUniques)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.likelyAutomated && (
                    <span
                      className="mr-1 cursor-help text-xs"
                      title="Many clones but few views — most likely CI, mirrors or deploys rather than people (a guess: GitHub doesn't say who cloned)"
                    >
                      🤖
                    </span>
                  )}
                  {fmt(r.clones)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{fmt(r.cloneUniques)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmt(r.stars)}
                  {r.starsDelta > 0 && <span className="ml-1 text-xs text-emerald-400">+{r.starsDelta}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmt(r.forks)}
                  {r.forksDelta > 0 && <span className="ml-1 text-xs text-emerald-400">+{r.forksDelta}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                  {r.linesOfCode === null ? "—" : fmt(r.linesOfCode)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${healthColor(r.health)}`} title="GitHub community health">
                  {r.health === null ? "—" : `${r.health}%`}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${rateColor(r.ciPassRate)}`} title="Actions pass rate in this range">
                  {pct(r.ciPassRate)}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">
                  {/* Fixed locale + UTC so the server render and the browser's hydration agree */}
                  {r.pushedAt ? new Date(r.pushedAt).toLocaleDateString("en-US", { timeZone: "UTC" }) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
