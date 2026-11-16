"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Series = { key: string; label: string; color: string; dashed?: boolean };
export type Marker = { date: string; label: string; kind?: "note" | "alert" | "release" };

const MARKER_COLOR = { note: "#a1a1aa", alert: "#d29922", release: "#3fb950" } as const;

const axis = { stroke: "#52525b", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltip = {
  contentStyle: { background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#a1a1aa" },
} as const;

const shortMonth = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const shortDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function TimeSeriesChart({
  data,
  series,
  area = false,
  height = 260,
  emptyText = "No data yet — run a sync.",
  markers = [],
  monthly = false,
}: {
  data: Record<string, unknown>[];
  series: Series[];
  area?: boolean;
  height?: number;
  emptyText?: string;
  /** Vertical reference lines (notes, alerts); only drawn for dates present in `data` */
  markers?: Marker[];
  /** Data points are months ("YYYY-MM-01"): label the axis "Jan 2026" */
  monthly?: boolean;
}) {
  const fmtDate = monthly ? shortMonth : shortDate;
  if (!data.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-zinc-500">{emptyText}</div>;
  }
  const Chart = area ? AreaChart : LineChart;
  // Merge markers on the same day; skip dates the chart doesn't have.
  const dates = new Set(data.map((d) => String(d.date)));
  const byDate = new Map<string, Marker[]>();
  for (const m of markers) if (dates.has(m.date)) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
  const markerText = (d: string) => (byDate.get(d) ?? []).map((m) => m.label).join(" · ");
  // Only label lines that have room; close neighbours still show their text in the tooltip.
  const index = new Map(data.map((d, i) => [String(d.date), i]));
  const minGap = Math.max(2, Math.round(data.length * 0.15));
  const labelled = new Set<string>();
  let lastIdx = -Infinity;
  for (const date of [...byDate.keys()].sort()) {
    const i = index.get(date)!;
    if (i - lastIdx >= minGap) {
      labelled.add(date);
      lastIdx = i;
    }
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDate} {...axis} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip
          {...tooltip}
          labelFormatter={(l) => {
            const note = markerText(String(l));
            return note ? `${fmtDate(String(l))} — ${note}` : fmtDate(String(l));
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {[...byDate].map(([date, ms]) => {
          // Several markers on one day: alerts win, then releases, then notes
          const color = MARKER_COLOR[ms.some((m) => m.kind === "alert") ? "alert" : ms.some((m) => m.kind === "release") ? "release" : "note"];
          const text = markerText(date);
          return (
            <ReferenceLine
              key={date}
              x={date}
              stroke={color}
              strokeDasharray="3 3"
              label={
                labelled.has(date)
                  ? {
                      value: text.length > 22 ? text.slice(0, 21) + "…" : text,
                      position: "insideTopRight",
                      // Alternate two rows so neighbouring labels don't run into each other
                      offset: [...labelled].indexOf(date) % 2 ? 18 : 5,
                      fill: color,
                      fontSize: 10,
                    }
                  : undefined
              }
            />
          );
        })}
        {series.map((s) =>
          area ? (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
          ) : (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} strokeDasharray={s.dashed ? "4 3" : undefined} isAnimationActive={false} />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}
