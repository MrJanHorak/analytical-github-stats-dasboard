import { fmt } from "@/lib/utils";

export function StatCard({ label, value, sub, delta }: { label: string; value: number; sub?: string; delta?: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(value)}</div>
      <div className="mt-1 h-4 text-xs text-zinc-500">
        {delta !== undefined && delta !== 0 && (
          <span className={delta > 0 ? "text-emerald-400" : "text-rose-400"}>
            {delta > 0 ? "+" : ""}
            {fmt(delta)}{" "}
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}
