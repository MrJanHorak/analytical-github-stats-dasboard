/** Small display helpers shared by server and client components. */

export const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** CI pass-rate colour: green ≥ 90%, amber ≥ 70%, red below. */
export const rateColor = (r: number | null) =>
  r === null ? "text-zinc-500" : r >= 0.9 ? "text-emerald-400" : r >= 0.7 ? "text-amber-400" : "text-red-400";

/** Community-health colour: green ≥ 80%, amber ≥ 50%, red below. */
export const healthColor = (p: number | null) =>
  p === null ? "text-zinc-600" : p >= 80 ? "text-emerald-400" : p >= 50 ? "text-amber-400" : "text-red-400";
