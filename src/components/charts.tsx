"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Series = { key: string; label: string; color: string; dashed?: boolean };

const axis = { stroke: "#52525b", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltip = {
  contentStyle: { background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "#a1a1aa" },
} as const;

const shortDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function TimeSeriesChart({
  data,
  series,
  area = false,
  height = 260,
  emptyText = "No data yet — run a sync.",
}: {
  data: Record<string, unknown>[];
  series: Series[];
  area?: boolean;
  height?: number;
  emptyText?: string;
}) {
  if (!data.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-zinc-500">{emptyText}</div>;
  }
  const Chart = area ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="#27272a" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...axis} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip {...tooltip} labelFormatter={(l) => shortDate(String(l))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
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
