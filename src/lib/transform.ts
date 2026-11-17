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

/**
 * Pivot long referrer rows into chart rows `{date, r0, r1, …}` for the given referrers.
 * Keys are neutral (r0…) because referrer names contain dots, which Recharts treats as paths.
 * A referrer absent on a date (fell out of GitHub's top 10) is 0.
 */
export function pivotReferrers(rows: { date: string; referrer: string; count: number }[], referrers: string[]) {
  const keyOf = new Map(referrers.map((r, i) => [r, `r${i}`]));
  const byDate = new Map<string, Record<string, string | number>>();
  for (const row of rows) {
    const key = keyOf.get(row.referrer);
    if (!key) continue;
    let d = byDate.get(row.date);
    if (!d) byDate.set(row.date, (d = { date: row.date, ...Object.fromEntries([...keyOf.values()].map((k) => [k, 0])) }));
    d[key] = (Number(d[key]) || 0) + row.count;
  }
  return {
    data: [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    series: referrers.map((r, i) => ({ key: `r${i}`, label: r })),
  };
}

export type SpikeOptions = { factor: number; minValue: number; minBaselineDays: number };

/**
 * Is the last value in `series` a spike relative to the mean of the values before it?
 * `series` is a dense daily series (oldest → newest) whose last element is the day being judged.
 * Requires `minBaselineDays` of history so a brand-new install doesn't flag everything.
 */
export function detectSpike(
  series: number[],
  { factor, minValue, minBaselineDays }: SpikeOptions,
): { spike: boolean; value: number; baseline: number } {
  const value = series.at(-1) ?? 0;
  const before = series.slice(0, -1);
  const baseline = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
  const spike = before.length >= minBaselineDays && value >= minValue && value >= Math.max(baseline, 1) * factor;
  return { spike, value, baseline };
}

/** Milestones crossed going from `prev` to `cur` (exclusive of prev, inclusive of cur). */
export function crossedMilestones(prev: number, cur: number, milestones: readonly number[]): number[] {
  return milestones.filter((m) => prev < m && cur >= m);
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

/** Sum bytes per language across repos, largest first, with how many repos use each. */
export function aggregateLanguages(rows: { repoId: number; language: string; bytes: number }[]) {
  const by = new Map<string, { language: string; bytes: number; repos: number }>();
  for (const r of rows) {
    const cur = by.get(r.language) ?? { language: r.language, bytes: 0, repos: 0 };
    cur.bytes += r.bytes;
    cur.repos += 1;
    by.set(r.language, cur);
  }
  return [...by.values()].sort((a, b) => b.bytes - a.bytes || a.language.localeCompare(b.language));
}

/** Keep the top `n` entries and fold the rest into one "Other" entry (bytes only). */
export function topWithOther<T extends { language: string; bytes: number }>(
  items: T[],
  n: number,
): (T | { language: string; bytes: number })[] {
  if (items.length <= n) return items;
  const rest = items.slice(n).reduce((a, i) => a + i.bytes, 0);
  return [...items.slice(0, n), { language: "Other", bytes: rest }];
}

export const AUTOMATED_MIN_CLONES = 10;

/**
 * Heuristic only — GitHub reports no user agents, so there is no way to know who cloned.
 * People usually look at a repo before cloning it; CI runs, mirrors and deploy hosts
 * (Vercel/Netlify clone on every build) clone without viewing. So many clones with
 * comparatively few views most likely means automation.
 */
export function likelyAutomated({ views, clones }: { views: number; clones: number }): boolean {
  return clones >= AUTOMATED_MIN_CLONES && clones > 2 * views;
}

// --- Contributions (/me) -------------------------------------------------------------------------

const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Current and longest streak of days with at least one contribution. A streak still counts as
 * current if today has nothing yet but yesterday did (the day isn't over).
 */
export function contributionStreaks(days: { date: string; count: number }[], today: string) {
  const active = new Set(days.filter((d) => d.count > 0).map((d) => d.date));
  let longest = 0;
  let longestEnd: string | null = null;
  for (const date of [...active].sort()) {
    if (active.has(addDays(date, -1))) continue; // not the start of a run
    let len = 1;
    while (active.has(addDays(date, len))) len++;
    if (len > longest) {
      longest = len;
      longestEnd = addDays(date, len - 1);
    }
  }
  let cursor = active.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (active.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest, longestEnd };
}

export type HeatCell = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 } | null;

/**
 * GitHub-style heatmap: `weeks` columns of 7 days (Sunday first) ending with the week of `until`.
 * Days after `until` are null. Levels split the non-zero counts into quartiles of the busiest day.
 */
export function heatmapWeeks(days: { date: string; count: number }[], until: string, weeks = 53): HeatCell[][] {
  const by = new Map(days.map((d) => [d.date, d.count]));
  const end = new Date(until + "T00:00:00Z");
  const start = addDays(until, -end.getUTCDay() - (weeks - 1) * 7);
  const cols: { date: string; count: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    cols.push(Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      return { date, count: by.get(date) ?? 0 };
    }));
  }
  const max = Math.max(0, ...cols.flat().filter((c) => c.date <= until).map((c) => c.count));
  const level = (n: number): 0 | 1 | 2 | 3 | 4 => (n <= 0 || !max ? 0 : (Math.min(4, Math.ceil((n / max) * 4)) as 1 | 2 | 3 | 4));
  return cols.map((col) => col.map((c) => (c.date > until ? null : { ...c, level: level(c.count) })));
}

/** Sum per-year repo rows into all-time totals per repo, busiest first. */
export function aggregateContributedRepos(rows: { repo: string; commits: number; pullRequests: number }[], login: string) {
  const by = new Map<string, { repo: string; commits: number; pullRequests: number; own: boolean }>();
  for (const r of rows) {
    const cur = by.get(r.repo) ?? { repo: r.repo, commits: 0, pullRequests: 0, own: r.repo.split("/")[0].toLowerCase() === login.toLowerCase() };
    cur.commits += r.commits;
    cur.pullRequests += r.pullRequests;
    by.set(r.repo, cur);
  }
  return [...by.values()].sort((a, b) => b.commits + b.pullRequests - (a.commits + a.pullRequests) || a.repo.localeCompare(b.repo));
}

/** Weekly [unix week, additions, deletions] → monthly totals with a running net line count. */
export function monthlyCodeFrequency(weeks: number[][]) {
  const by = new Map<string, { date: string; additions: number; deletions: number }>();
  for (const [ts, add = 0, del = 0] of weeks) {
    const date = new Date(ts * 1000).toISOString().slice(0, 7) + "-01";
    const cur = by.get(date) ?? { date, additions: 0, deletions: 0 };
    cur.additions += add;
    cur.deletions += Math.abs(del);
    by.set(date, cur);
  }
  let net = 0;
  return [...by.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => ({ ...m, net: (net += m.additions - m.deletions) }));
}

// --- Repo activity (M3.7) -----------------------------------------------------------------------

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Associations that mean "you or your team"; everything else opened by a human is an outside contribution. */
const TEAM = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
export const isOutside = (i: { authorAssociation: string; isBot: boolean }) => !i.isBot && !TEAM.has(i.authorAssociation);

type IssueRow = {
  isPr: boolean;
  state: string;
  author: string | null;
  authorAssociation: string;
  isBot: boolean;
  createdAt: Date;
  closedAt: Date | null;
  mergedAt: Date | null;
};

const HOUR = 3_600_000;
const inRange = (d: Date | null, since: Date) => !!d && d >= since;

/**
 * Issue & PR flow since `since`: opened/closed/merged counts, median hours to close issues and to
 * merge PRs (for items closed/merged in the range), what's open now, and outside contributors.
 */
export function issueFlow(items: IssueRow[], since: Date) {
  const iss = items.filter((i) => !i.isPr);
  const prs = items.filter((i) => i.isPr);
  const closedIssues = iss.filter((i) => inRange(i.closedAt, since));
  const merged = prs.filter((p) => inRange(p.mergedAt, since));
  const outside = items.filter((i) => inRange(i.createdAt, since) && isOutside(i));
  const contributors = new Map<string, number>();
  for (const o of outside) if (o.author) contributors.set(o.author, (contributors.get(o.author) ?? 0) + 1);
  return {
    issuesOpened: iss.filter((i) => inRange(i.createdAt, since)).length,
    issuesClosed: closedIssues.length,
    prsOpened: prs.filter((p) => inRange(p.createdAt, since)).length,
    prsMerged: merged.length,
    prsClosedUnmerged: prs.filter((p) => inRange(p.closedAt, since) && !p.mergedAt).length,
    openIssues: iss.filter((i) => i.state === "open").length,
    openPrs: prs.filter((p) => p.state === "open").length,
    medianHoursToClose: median(closedIssues.map((i) => (i.closedAt!.getTime() - i.createdAt.getTime()) / HOUR)),
    medianHoursToMerge: median(merged.map((p) => (p.mergedAt!.getTime() - p.createdAt.getTime()) / HOUR)),
    outsideItems: outside.length,
    outsideContributors: [...contributors.entries()]
      .map(([login, count]) => ({ login, count }))
      .sort((a, b) => b.count - a.count || a.login.localeCompare(b.login)),
    botItems: items.filter((i) => inRange(i.createdAt, since) && i.isBot).length,
  };
}

/** Weekly opened vs closed (issues + PRs) since `since`, for a chart. Weeks start on the Monday. */
export function weeklyIssueFlow(items: IssueRow[], since: string, until: string) {
  const weekOf = (d: string) => {
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  };
  const out = new Map<string, { date: string; opened: number; closed: number }>();
  for (let d = weekOf(since); d <= until; ) {
    out.set(d, { date: d, opened: 0, closed: 0 });
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + 7);
    d = t.toISOString().slice(0, 10);
  }
  for (const i of items) {
    const c = i.createdAt.toISOString().slice(0, 10);
    if (c >= since && c <= until) out.get(weekOf(c))!.opened++;
    const x = i.closedAt?.toISOString().slice(0, 10);
    if (x && x >= since && x <= until) out.get(weekOf(x))!.closed++;
  }
  return [...out.values()];
}

/** Conclusions that count as a pass or a failure; cancelled/skipped/neutral runs are left out of the rate. */
const PASS = new Set(["success"]);
const FAIL = new Set(["failure", "timed_out", "startup_failure"]);

type RunRow = {
  workflow: string;
  status: string;
  conclusion: string | null;
  createdAt: Date;
  startedAt: Date | null;
  updatedAt: Date;
  branch?: string | null;
  repo?: string;
};

function runSummary(runs: RunRow[]) {
  const passed = runs.filter((r) => r.conclusion && PASS.has(r.conclusion)).length;
  const failed = runs.filter((r) => r.conclusion && FAIL.has(r.conclusion)).length;
  const durations = runs
    .filter((r) => r.status === "completed" && r.startedAt && (PASS.has(r.conclusion ?? "") || FAIL.has(r.conclusion ?? "")))
    .map((r) => (r.updatedAt.getTime() - r.startedAt!.getTime()) / 1000)
    .filter((s) => s >= 0);
  return {
    runs: runs.length,
    passed,
    failed,
    passRate: passed + failed ? passed / (passed + failed) : null,
    medianSeconds: median(durations),
  };
}

/** Actions stats since `since`: overall and per workflow (busiest first), plus recent failures. */
export function ciStats(runs: RunRow[], since: Date) {
  const recent = runs.filter((r) => r.createdAt >= since).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const by = new Map<string, RunRow[]>();
  for (const r of recent) {
    const key = r.repo ? `${r.repo}\u0000${r.workflow}` : r.workflow;
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push(r);
  }
  return {
    ...runSummary(recent),
    workflows: [...by.values()]
      .map((rs) => ({
        workflow: rs[0].workflow,
        repo: rs[0].repo,
        ...runSummary(rs),
        last: { conclusion: rs[0].conclusion ?? rs[0].status, at: rs[0].createdAt },
      }))
      .sort((a, b) => b.runs - a.runs || a.workflow.localeCompare(b.workflow)),
    recentFailures: recent.filter((r) => r.conclusion && FAIL.has(r.conclusion)).slice(0, 5),
  };
}

/** "3h", "2.5d", "45m" */
export function shortDuration(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

// --- Frameworks (M3.8) ---------------------------------------------------------------------------

/**
 * Frameworks across repos, grouped by category (in `categoryOrder`), most-used first: how many
 * repos declare each and the newest version seen.
 */
export function aggregateFrameworks(
  rows: { repoId: number; framework: string; category: string; version: string | null }[],
  categoryOrder: readonly string[],
) {
  const by = new Map<string, { name: string; category: string; repos: number; newest: string | null }>();
  for (const r of rows) {
    const cur = by.get(r.framework) ?? { name: r.framework, category: r.category, repos: 0, newest: null };
    cur.repos++;
    if (r.version && (!cur.newest || versionCompare(r.version, cur.newest) > 0)) cur.newest = r.version;
    by.set(r.framework, cur);
  }
  const all = [...by.values()];
  return categoryOrder
    .map((category) => ({
      category,
      frameworks: all.filter((f) => f.category === category).sort((a, b) => b.repos - a.repos || a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.frameworks.length);
}

function versionCompare(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// --- Code health (M3.9) --------------------------------------------------------------------------

const majorMinor = (v: string) => {
  const [maj, min] = v.split(".").map((n) => parseInt(n, 10));
  return { maj: Number.isFinite(maj) ? maj : 0, min: Number.isFinite(min) ? min : 0 };
};

/**
 * True when `declared` is a major version behind `latest` (for 0.x packages, where minors are
 * breaking, a minor behind). Pre-release "latest" tags never count.
 */
export function isOutdated(declared: string | null, latest: string | null): boolean {
  if (!declared || !latest || /[-+]/.test(latest)) return false;
  const d = majorMinor(declared);
  const l = majorMinor(latest);
  if (l.maj !== d.maj) return l.maj > d.maj;
  return l.maj === 0 && l.min > d.min;
}

/** Frameworks declared at an older major version than the latest release, with the repos affected. */
export function outdatedFrameworks(
  rows: { repo: string; framework: string; version: string | null; package: string | null; ecosystem: string | null }[],
  latest: Map<string, string | null>,
) {
  const by = new Map<string, { framework: string; latest: string; repos: { repo: string; version: string }[] }>();
  for (const r of rows) {
    if (!r.package || !r.ecosystem || !r.version) continue;
    const l = latest.get(`${r.ecosystem}:${r.package}`) ?? null;
    if (!l || !isOutdated(r.version, l)) continue;
    const cur = by.get(r.framework) ?? { framework: r.framework, latest: l, repos: [] };
    cur.repos.push({ repo: r.repo, version: r.version });
    by.set(r.framework, cur);
  }
  return [...by.values()]
    .map((f) => ({ ...f, repos: f.repos.sort((a, b) => a.repo.localeCompare(b.repo)) }))
    .sort((a, b) => b.repos.length - a.repos.length || a.framework.localeCompare(b.framework));
}

const DEPLOY_OK = new Set(["success"]);
const DEPLOY_FAIL = new Set(["failure", "error"]);

/** Deployments since `since`: production vs preview, success rate, per repo and per week. */
export function deployStats(
  rows: { repo: string; production: boolean; state: string | null; createdAt: Date }[],
  since: string,
  until: string,
) {
  const sinceTs = new Date(since + "T00:00:00Z");
  const recent = rows.filter((r) => r.createdAt >= sinceTs);
  const prod = recent.filter((r) => r.production);
  const ok = recent.filter((r) => r.state && DEPLOY_OK.has(r.state)).length;
  const failed = recent.filter((r) => r.state && DEPLOY_FAIL.has(r.state)).length;
  const days = Math.max(1, (new Date(until + "T00:00:00Z").getTime() - sinceTs.getTime()) / 86_400_000 + 1);
  const byRepo = new Map<string, { repo: string; production: number; preview: number; last: Date }>();
  for (const r of recent) {
    const cur = byRepo.get(r.repo) ?? { repo: r.repo, production: 0, preview: 0, last: r.createdAt };
    if (r.production) cur.production++;
    else cur.preview++;
    if (r.createdAt > cur.last) cur.last = r.createdAt;
    byRepo.set(r.repo, cur);
  }
  // Weekly production / preview counts, Monday weeks
  const weekOf = (d: Date) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  };
  const weeks = new Map<string, { date: string; production: number; preview: number }>();
  for (let t = new Date(weekOf(sinceTs) + "T00:00:00Z"); t.toISOString().slice(0, 10) <= until; t.setUTCDate(t.getUTCDate() + 7))
    weeks.set(t.toISOString().slice(0, 10), { date: t.toISOString().slice(0, 10), production: 0, preview: 0 });
  for (const r of recent) {
    const w = weeks.get(weekOf(r.createdAt));
    if (w) w[r.production ? "production" : "preview"]++;
  }
  return {
    total: recent.length,
    production: prod.length,
    preview: recent.length - prod.length,
    productionPerWeek: Math.round((prod.length / days) * 7 * 10) / 10,
    successRate: ok + failed ? ok / (ok + failed) : null,
    failed,
    byRepo: [...byRepo.values()].sort((a, b) => b.production + b.preview - (a.production + a.preview) || a.repo.localeCompare(b.repo)),
    weekly: [...weeks.values()],
  };
}

/**
 * Lines of code (and test lines) over time, summed across repos: each repo contributes its most
 * recent snapshot on or before each day. Days before any snapshot are left out.
 */
export function codeHistory(snapshots: { repoId: number; date: string; linesOfCode: number; testLines: number }[], since: string, until: string) {
  const byRepo = new Map<number, { date: string; linesOfCode: number; testLines: number }[]>();
  for (const s of [...snapshots].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!byRepo.has(s.repoId)) byRepo.set(s.repoId, []);
    byRepo.get(s.repoId)!.push(s);
  }
  const first = snapshots.reduce<string | null>((m, s) => (!m || s.date < m ? s.date : m), null);
  if (!first) return [];
  const out: { date: string; lines: number; tests: number }[] = [];
  const idx = new Map<number, number>();
  for (let t = new Date((first > since ? first : since) + "T00:00:00Z"); t.toISOString().slice(0, 10) <= until; t.setUTCDate(t.getUTCDate() + 1)) {
    const day = t.toISOString().slice(0, 10);
    let lines = 0;
    let tests = 0;
    for (const [repoId, list] of byRepo) {
      let i = idx.get(repoId) ?? -1;
      while (i + 1 < list.length && list[i + 1].date <= day) i++;
      idx.set(repoId, i);
      if (i >= 0) {
        lines += list[i].linesOfCode;
        tests += list[i].testLines;
      }
    }
    out.push({ date: day, lines, tests });
  }
  return out;
}

// --- Per-repo alert settings (M4a) ----------------------------------------------------------------

/**
 * Read the repo alert-settings form. Blank number fields mean "use the global default" (null);
 * out-of-range values are clamped. Returns null when nothing differs from the defaults, so the
 * override row can be removed.
 */
export function parseAlertOverride(get: (key: string) => string | null) {
  const int = (k: string, min: number, max: number) => {
    const v = get(k)?.trim();
    if (!v || Number.isNaN(Number(v))) return null;
    return Math.min(max, Math.max(min, Math.round(Number(v))));
  };
  const factor = (() => {
    const v = get("spikeFactor")?.trim();
    if (!v || Number.isNaN(Number(v))) return null;
    return Math.min(100, Math.max(1.1, Math.round(Number(v) * 10) / 10));
  })();
  const o = {
    muted: get("muted") === "on",
    milestones: get("milestones") === "on",
    spikeFactor: factor,
    minViews: int("minViews", 0, 1_000_000),
    minClones: int("minClones", 0, 1_000_000),
    starBurst: int("starBurst", 1, 100_000),
  };
  const isDefault = !o.muted && o.milestones && o.spikeFactor === null && o.minViews === null && o.minClones === null && o.starBurst === null;
  return isDefault ? null : o;
}
