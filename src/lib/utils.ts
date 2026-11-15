/** YYYY-MM-DD in UTC (GitHub traffic timestamps are UTC midnight). */
export function isoDay(d: Date | string = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

export function daysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDay(d);
}

export const fmt = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-US", { notation: (n ?? 0) >= 10000 ? "compact" : "standard" }).format(n ?? 0);

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export const RANGES = [7, 14, 30, 90, 365] as const;

export function parseRange(v: string | string[] | undefined) {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (RANGES as readonly number[]).includes(n) ? n : 30;
}
