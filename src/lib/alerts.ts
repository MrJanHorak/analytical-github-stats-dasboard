import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { crossedMilestones, detectSpike, fillDaily } from "./transform";
import { daysAgo, fmt } from "./utils";

const { alerts, repos, repoSnapshots, starEvents, trafficDaily } = schema;

export const STAR_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000] as const;

export type AlertConfig = {
  enabled: boolean;
  /** Day's value must be ≥ factor × trailing average */
  spikeFactor: number;
  minViews: number;
  minClones: number;
  /** Stars gained in one day to count as a burst */
  starBurst: number;
  /** Days of history needed before spikes are judged */
  baselineDays: number;
  webhookUrl?: string;
  appUrl?: string;
};

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);

export function alertConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AlertConfig {
  return {
    enabled: env.ALERTS_ENABLED !== "false",
    spikeFactor: num(env.ALERT_SPIKE_FACTOR, 3),
    minViews: num(env.ALERT_MIN_VIEWS, 25),
    minClones: num(env.ALERT_MIN_CLONES, 10),
    starBurst: num(env.ALERT_STAR_BURST, 5),
    baselineDays: 7,
    webhookUrl: env.ALERT_WEBHOOK_URL || undefined,
    appUrl: env.APP_URL?.replace(/\/$/, "") || undefined,
  };
}

type NewAlert = typeof alerts.$inferInsert;

/**
 * Look at the last complete UTC day (yesterday — today is still partial) and record alerts.
 * Idempotent: (repo, date, kind) is unique, so re-running a sync never duplicates alerts.
 * Returns only alerts created by this call.
 */
export async function evaluateAlerts(config = alertConfigFromEnv()) {
  if (!config.enabled) return [];
  const db = getDb();
  const day = daysAgo(1);
  const since = daysAgo(15); // 14-day baseline + the day itself

  const [allRepos, traffic, stars, snapshots] = await Promise.all([
    db.select({ id: repos.id, fullName: repos.fullName }).from(repos),
    db
      .select()
      .from(trafficDaily)
      .where(and(gte(trafficDaily.date, since), lte(trafficDaily.date, day))),
    db
      .select({ repoId: starEvents.repoId, n: sql<number>`count(*)::int` })
      .from(starEvents)
      .where(
        and(gte(starEvents.starredAt, new Date(day + "T00:00:00Z")), lt(starEvents.starredAt, new Date(daysAgo(0) + "T00:00:00Z"))),
      )
      .groupBy(starEvents.repoId),
    // Latest two snapshots per repo → milestone crossings
    db
      .select({
        repoId: repoSnapshots.repoId,
        date: repoSnapshots.date,
        stars: repoSnapshots.stars,
        rn: sql<number>`row_number() over (partition by ${repoSnapshots.repoId} order by ${repoSnapshots.date} desc)`.as("rn"),
      })
      .from(repoSnapshots),
  ]);

  const byRepo = new Map<number, (typeof traffic)[number][]>();
  for (const t of traffic) {
    if (!byRepo.has(t.repoId)) byRepo.set(t.repoId, []);
    byRepo.get(t.repoId)!.push(t);
  }
  const starsBy = new Map(stars.map((s) => [s.repoId, s.n]));
  const snapsBy = new Map<number, { date: string; stars: number }[]>();
  for (const s of snapshots.filter((s) => Number(s.rn) <= 2)) {
    if (!snapsBy.has(s.repoId)) snapsBy.set(s.repoId, []);
    snapsBy.get(s.repoId)!.push(s);
  }

  const candidates: NewAlert[] = [];
  for (const r of allRepos) {
    const rows = byRepo.get(r.id) ?? [];
    // Only judge repos whose stored history actually reaches back far enough
    const firstDay = rows.reduce((m, x) => (x.date < m ? x.date : m), day);
    const history = fillDaily(rows, "views", firstDay, day);
    const cloneHistory = fillDaily(rows, "clones", firstDay, day);

    const v = detectSpike(history, { factor: config.spikeFactor, minValue: config.minViews, minBaselineDays: config.baselineDays });
    if (v.spike) {
      candidates.push({
        repoId: r.id,
        date: day,
        kind: "views_spike",
        value: v.value,
        baseline: v.baseline,
        message: `${r.fullName}: ${fmt(v.value)} views on ${day} (${(v.value / Math.max(v.baseline, 1)).toFixed(1)}× the usual ${v.baseline.toFixed(0)}/day)`,
      });
    }
    const c = detectSpike(cloneHistory, { factor: config.spikeFactor, minValue: config.minClones, minBaselineDays: config.baselineDays });
    if (c.spike) {
      candidates.push({
        repoId: r.id,
        date: day,
        kind: "clones_spike",
        value: c.value,
        baseline: c.baseline,
        message: `${r.fullName}: ${fmt(c.value)} clones on ${day} (usually ${c.baseline.toFixed(0)}/day)`,
      });
    }

    const gained = starsBy.get(r.id) ?? 0;
    if (gained >= config.starBurst) {
      candidates.push({
        repoId: r.id,
        date: day,
        kind: "stars_burst",
        value: gained,
        message: `${r.fullName}: +${gained} stars on ${day}`,
      });
    }

    const [latest, previous] = snapsBy.get(r.id) ?? [];
    if (latest && previous) {
      for (const m of crossedMilestones(previous.stars, latest.stars, STAR_MILESTONES)) {
        candidates.push({
          repoId: r.id,
          date: latest.date,
          kind: `stars_milestone_${m}`,
          value: m,
          message: `${r.fullName} reached ${fmt(m)} stars ⭐`,
        });
      }
    }
  }

  if (!candidates.length) return [];
  const created = await db.insert(alerts).values(candidates).onConflictDoNothing().returning();
  return created;
}

/** Send not-yet-notified alerts to a Slack- or Discord-compatible webhook. */
export async function notifyAlerts(config = alertConfigFromEnv(), fetchImpl: typeof fetch = fetch) {
  if (!config.webhookUrl) return 0;
  const db = getDb();
  const pending = await db
    .select({ alert: alerts, fullName: repos.fullName })
    .from(alerts)
    .innerJoin(repos, eq(repos.id, alerts.repoId))
    .where(isNull(alerts.notifiedAt))
    .orderBy(desc(alerts.date))
    .limit(20);
  if (!pending.length) return 0;

  const lines = pending.map(({ alert, fullName }) =>
    config.appUrl ? `• ${alert.message} — ${config.appUrl}/repo/${fullName}` : `• ${alert.message}`,
  );
  const text = `📈 GitHub repo stats\n${lines.join("\n")}`;
  // `text` is Slack's field, `content` is Discord's; each ignores the other.
  const res = await fetchImpl(config.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, content: text.slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`Alert webhook responded ${res.status}`);

  const ids = pending.map((p) => p.alert.id);
  await db
    .update(alerts)
    .set({ notifiedAt: new Date() })
    .where(sql`${alerts.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  return pending.length;
}
