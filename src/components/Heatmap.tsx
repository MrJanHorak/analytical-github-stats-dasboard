import type { HeatCell } from "@/lib/transform";

// GitHub's dark-theme contribution greens
const LEVEL = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"] as const;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

const monthLabel = (date: string) => new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** GitHub-style contribution calendar: one column per week, Sunday at the top. */
export function Heatmap({ weeks }: { weeks: HeatCell[][] }) {
  // A month label over the first week whose Sunday falls in a new month (skip a cramped first one)
  const labels = weeks.map((w, i) => {
    const first = w[0]?.date;
    if (!first) return "";
    const prev = weeks[i - 1]?.[0]?.date;
    if (prev && prev.slice(5, 7) === first.slice(5, 7)) return "";
    return i === 0 && Number(first.slice(8)) > 14 ? "" : monthLabel(first);
  });
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `auto repeat(${weeks.length}, 11px)` }}>
        <span />
        {labels.map((l, i) => (
          <span key={i} className="h-3 overflow-visible whitespace-nowrap text-[10px] leading-3 text-zinc-500">
            {l}
          </span>
        ))}
        {DAY_LABELS.map((label, day) => (
          <Row key={day} label={label} cells={weeks.map((w) => w[day])} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-zinc-500">
        Less
        {LEVEL.map((c) => (
          <span key={c} className="h-[11px] w-[11px] rounded-sm" style={{ background: c }} />
        ))}
        More
      </div>
    </div>
  );
}

function Row({ label, cells }: { label: string; cells: HeatCell[] }) {
  return (
    <>
      <span className="pr-1 text-[10px] leading-[11px] text-zinc-500">{label}</span>
      {cells.map((c, i) =>
        c ? (
          <span
            key={i}
            className="h-[11px] w-[11px] rounded-sm"
            style={{ background: LEVEL[c.level] }}
            title={`${c.count} contribution${c.count === 1 ? "" : "s"} on ${c.date}`}
          />
        ) : (
          <span key={i} />
        ),
      )}
    </>
  );
}
