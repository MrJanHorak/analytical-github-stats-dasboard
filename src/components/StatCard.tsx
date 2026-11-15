import { pctChange } from "@/lib/transform";
import { fmt } from "@/lib/utils";

type Props = {
  label: string;
  value: number;
  sub?: string;
  /** Absolute change to show, e.g. "+12 stars" */
  delta?: number;
  /** Value for the previous equal-length period → shows "% vs prev" */
  previous?: number | null;
  /** Extra line under the card, e.g. GitHub's deduplicated 14-day uniques */
  note?: string;
};

export function StatCard({ label, value, sub, delta, previous, note }: Props) {
  const pct = previous === undefined || previous === null ? null : pctChange(value, previous);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(value)}</div>
      <div className="mt-1 h-4 truncate text-xs text-zinc-500">
        {delta !== undefined && (
          <span className={delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-zinc-500"}>
            {delta >= 0 ? "+" : ""}
            {fmt(delta)}{" "}
          </span>
        )}
        {pct !== null && (
          <span className={pct >= 0 ? "text-emerald-400" : "text-rose-400"} title={`Previous period: ${fmt(previous)}`}>
            {pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%{" "}
          </span>
        )}
        {sub}
      </div>
      {note && <div className="mt-1 truncate text-xs text-zinc-400" title={note}>{note}</div>}
    </div>
  );
}
