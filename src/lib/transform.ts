/** Pure data-shaping helpers (no I/O) — unit tested in tests/transform.test.ts. */
import { isoDay } from "./utils";

export type TrafficPoint = { timestamp: string; count: number; uniques: number };
export type DayTraffic = { date: string; views: number; viewUniques: number; clones: number; cloneUniques: number };

/** Merge GitHub's separate views/clones series into one row per UTC day. */
export function mergeTraffic(views: TrafficPoint[] = [], clones: TrafficPoint[] = []): DayTraffic[] {
  const days = new Map<string, DayTraffic>();
  const row = (date: string) => {
    let r = days.get(date);
    if (!r) days.set(date, (r = { date, views: 0, viewUniques: 0, clones: 0, cloneUniques: 0 }));
    return r;
  };
  for (const v of views) Object.assign(row(isoDay(v.timestamp)), { views: v.count, viewUniques: v.uniques });
  for (const c of clones) Object.assign(row(isoDay(c.timestamp)), { clones: c.count, cloneUniques: c.uniques });
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Every UTC day from `since` to `until` inclusive, as YYYY-MM-DD. */
export function dayRange(since: string, until: string): string[] {
  const out: string[] = [];
  const d = new Date(since + "T00:00:00Z");
  const end = new Date(until + "T00:00:00Z");
  while (d <= end) {
    out.push(isoDay(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Dense numeric series over [since, until], zero-filling days with no row. */
export function fillDaily<T extends { date: string }>(
  rows: T[],
  key: keyof T,
  since: string,
  until: string,
): number[] {
  const by = new Map(rows.map((r) => [r.date, Number(r[key]) || 0]));
  return dayRange(since, until).map((d) => by.get(d) ?? 0);
}

/**
 * Turn event timestamps (e.g. starred_at) into a cumulative per-day series over [since, until].
 * Days before `since` are folded into the starting baseline. Days with no change are omitted
 * except the first and last, keeping charts light while preserving the step shape.
 */
export function cumulativeByDay(timestamps: (Date | string)[], since: string, until: string) {
  const sorted = timestamps.map((t) => isoDay(t)).sort();
  let total = 0;
  let i = 0;
  while (i < sorted.length && sorted[i] < since) {
    total++;
    i++;
  }
  const counts = new Map<string, number>();
  for (; i < sorted.length; i++) counts.set(sorted[i], (counts.get(sorted[i]) ?? 0) + 1);

  const days = dayRange(since, until);
  const out: { date: string; value: number }[] = [];
  days.forEach((date, idx) => {
    const add = counts.get(date) ?? 0;
    total += add;
    if (add || idx === 0 || idx === days.length - 1) out.push({ date, value: total });
  });
  return out;
}

/** Combine two cumulative series (e.g. stars + forks) on a shared date axis, carrying values forward. */
export function joinSeries(series: Record<string, { date: string; value: number }[]>) {
  const dates = [...new Set(Object.values(series).flatMap((s) => s.map((p) => p.date)))].sort();
  const cursors = Object.fromEntries(Object.keys(series).map((k) => [k, { i: 0, last: 0 }]));
  return dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const [k, s] of Object.entries(series)) {
      const c = cursors[k];
      while (c.i < s.length && s[c.i].date <= date) c.last = s[c.i++].value;
      row[k] = c.last;
    }
    return row;
  });
}

/** Sum consecutive values into at most `maxPoints` buckets (for sparklines over long ranges). */
export function bucket(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values;
  const size = Math.ceil(values.length / maxPoints);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size).reduce((a, b) => a + b, 0));
  return out;
}

/** Percentage change, or null when there's no baseline. */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

/** RFC 4180 CSV. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}
