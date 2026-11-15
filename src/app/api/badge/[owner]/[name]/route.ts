import { and, desc, eq, gte, sql } from "drizzle-orm";
import { compact, renderBadge } from "@/lib/badge";
import { getDb, schema } from "@/lib/db";
import { daysAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

const { repos, trafficDaily, trafficWindows, repoSnapshots } = schema;

const METRICS = {
  views: { label: "views", color: "#2f81f7" },
  visitors: { label: "visitors", color: "#a371f7" },
  clones: { label: "clones", color: "#3fb950" },
  stars: { label: "stars", color: "#d29922" },
  forks: { label: "forks", color: "#8b949e" },
} as const;
type Metric = keyof typeof METRICS;

/**
 * GET /api/badge/:owner/:name?metric=views|visitors|clones|stars|forks&range=30
 * Public (bypasses DASHBOARD_PASSWORD) but only for public repos. Disable with BADGES_ENABLED=false.
 */
export async function GET(req: Request, { params }: { params: Promise<{ owner: string; name: string }> }) {
  if (process.env.BADGES_ENABLED === "false") return new Response("Badges disabled", { status: 404 });
  const { owner, name } = await params;
  const url = new URL(req.url);
  const metric = (url.searchParams.get("metric") ?? "views") as Metric;
  if (!(metric in METRICS)) return new Response("Unknown metric", { status: 400 });
  const range = Math.min(Math.max(Number(url.searchParams.get("range")) || 30, 1), 365);
  const label = url.searchParams.get("label")?.slice(0, 40) || METRICS[metric].label;

  const db = getDb();
  const [repo] = await db.select().from(repos).where(eq(repos.fullName, `${owner}/${name}`)).limit(1);
  // Never reveal anything about private or unknown repos
  if (!repo || repo.isPrivate) return new Response("Not found", { status: 404 });

  let value = 0;
  let suffix = "";
  if (metric === "views" || metric === "clones") {
    const col = metric === "views" ? trafficDaily.views : trafficDaily.clones;
    const [row] = await db
      .select({ n: sql<number>`coalesce(sum(${col}),0)::int` })
      .from(trafficDaily)
      .where(and(eq(trafficDaily.repoId, repo.id), gte(trafficDaily.date, daysAgo(range - 1))));
    value = row?.n ?? 0;
    suffix = range === 30 ? "/month" : range === 7 ? "/week" : ` /${range}d`;
  } else if (metric === "visitors") {
    const [w] = await db
      .select()
      .from(trafficWindows)
      .where(eq(trafficWindows.repoId, repo.id))
      .orderBy(desc(trafficWindows.date))
      .limit(1);
    value = w?.viewUniques ?? 0;
    suffix = " /14d";
  } else {
    const [s] = await db
      .select()
      .from(repoSnapshots)
      .where(eq(repoSnapshots.repoId, repo.id))
      .orderBy(desc(repoSnapshots.date))
      .limit(1);
    value = (metric === "stars" ? s?.stars : s?.forks) ?? 0;
  }

  return new Response(renderBadge(label, `${compact(value)}${suffix}`, METRICS[metric].color), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // GitHub's camo proxy respects this; data only changes once a day anyway
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
