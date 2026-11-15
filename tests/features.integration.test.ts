/**
 * Alerts, webhook notifications, chart notes and badges against in-memory Postgres.
 * Data is inserted directly (no GitHub mock needed).
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { evaluateAlerts, notifyAlerts, type AlertConfig } from "@/lib/alerts";
import { schema, setDbForTesting } from "@/lib/db";
import { getOverview, getRepoDetail } from "@/lib/queries";
import { daysAgo, isoDay } from "@/lib/utils";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (fn: unknown) => fn }));

let pg: PGlite;
const config: AlertConfig = {
  enabled: true,
  spikeFactor: 3,
  minViews: 25,
  minClones: 10,
  starBurst: 5,
  baselineDays: 7,
  webhookUrl: "https://hooks.example.test/abc",
  appUrl: "https://stats.example.test",
};

beforeAll(async () => {
  pg = new PGlite();
  const dir = join(__dirname, "..", "drizzle");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  setDbForTesting(drizzle(pg, { schema }));

  await pg.exec(`
    insert into repos (id, owner, name, full_name, html_url, private) values
      (1, 'jan', 'rocket', 'jan/rocket', 'https://github.com/jan/rocket', false),
      (2, 'jan', 'quiet', 'jan/quiet', 'https://github.com/jan/quiet', false),
      (3, 'jan', 'secret', 'jan/secret', 'https://github.com/jan/secret', true);
  `);
  // rocket: ~10 views/day for two weeks, then 120 yesterday → spike. quiet: flat.
  for (let back = 15; back >= 1; back--) {
    const rocketViews = back === 1 ? 120 : 10;
    await pg.exec(`
      insert into traffic_daily (repo_id, date, views, view_uniques, clones, clone_uniques) values
        (1, '${daysAgo(back)}', ${rocketViews}, 5, 2, 1),
        (2, '${daysAgo(back)}', 30, 10, 3, 2),
        (3, '${daysAgo(back)}', ${back === 1 ? 500 : 5}, 1, 0, 0);
    `);
  }
  await pg.exec(`insert into traffic_windows values (1, '${isoDay()}', 260, 60, 30, 14)`);
  // Star milestone: 9 → 10 between the last two snapshots; burst: 6 stars yesterday
  await pg.exec(`
    insert into repo_snapshots values (1, '${daysAgo(1)}', 9, 1, 1, 0, 10), (1, '${isoDay()}', 10, 1, 1, 0, 10),
                                      (3, '${isoDay()}', 99, 0, 0, 0, 1);
  `);
  for (let i = 0; i < 6; i++) {
    await pg.exec(`insert into star_events values (1, 'fan${i}', '${daysAgo(1)}T1${i}:00:00Z')`);
  }
});

describe("alerts", () => {
  it("detects a views spike, a star burst and a milestone — not flat traffic", async () => {
    const created = await evaluateAlerts(config);
    const kinds = created.map((a) => `${a.repoId}:${a.kind}`).sort();
    expect(kinds).toEqual(["1:stars_burst", "1:stars_milestone_10", "1:views_spike", "3:views_spike"]);
    const spike = created.find((a) => a.kind === "views_spike" && a.repoId === 1)!;
    expect(spike.value).toBe(120);
    expect(spike.baseline).toBe(10);
    expect(spike.message).toContain("jan/rocket");
  });

  it("is idempotent", async () => {
    expect(await evaluateAlerts(config)).toEqual([]);
  });

  it("does nothing when disabled", async () => {
    await pg.exec("delete from alerts where kind = 'stars_burst'");
    expect(await evaluateAlerts({ ...config, enabled: false })).toEqual([]);
    expect((await evaluateAlerts(config)).map((a) => a.kind)).toEqual(["stars_burst"]);
  });

  it("posts pending alerts to the webhook once, with links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    expect(await notifyAlerts(config, fetchMock)).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(config.webhookUrl);
    const body = JSON.parse(init.body);
    expect(body.text).toContain("https://stats.example.test/repo/jan/rocket");
    expect(body.content).toBe(body.text); // Discord + Slack in one payload

    expect(await notifyAlerts(config, fetchMock)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces alerts on the overview and as chart markers", async () => {
    const o = await getOverview(30);
    expect(o.recentAlerts.length).toBe(4);
    const d = (await getRepoDetail("jan", "rocket", 30))!;
    expect(d.markers.filter((m) => m.kind === "alert").map((m) => m.label).sort()).toEqual([
      "10 ★",
      "star burst",
      "views spike",
    ]);
  });
});

describe("notes", () => {
  it("adds and deletes notes via server actions", async () => {
    const { addNote, deleteNote } = await import("@/app/repo/[owner]/[name]/actions");
    const fd = new FormData();
    fd.set("repo", "jan/rocket");
    fd.set("date", daysAgo(1));
    fd.set("label", "Posted on Hacker News");
    await addNote(fd);

    // Invalid input is ignored
    const bad = new FormData();
    bad.set("repo", "jan/rocket");
    bad.set("date", "yesterday");
    bad.set("label", "x");
    await addNote(bad);

    let d = (await getRepoDetail("jan", "rocket", 30))!;
    expect(d.notes.map((n) => n.label)).toEqual(["Posted on Hacker News"]);
    expect(d.markers).toContainEqual({ date: daysAgo(1), label: "Posted on Hacker News", kind: "note" });
    expect((await getOverview(30)).markers).toContainEqual({ date: daysAgo(1), label: "rocket: Posted on Hacker News" });

    // A note can't be deleted through another repo's form
    const wrong = new FormData();
    wrong.set("id", String(d.notes[0].id));
    wrong.set("repo", "jan/quiet");
    await deleteNote(wrong);
    expect((await getRepoDetail("jan", "rocket", 30))!.notes).toHaveLength(1);

    const del = new FormData();
    del.set("id", String(d.notes[0].id));
    del.set("repo", "jan/rocket");
    await deleteNote(del);
    d = (await getRepoDetail("jan", "rocket", 30))!;
    expect(d.notes).toEqual([]);
  });
});

describe("badges", () => {
  const call = async (path: string, query = "") => {
    const { GET } = await import("@/app/api/badge/[owner]/[name]/route");
    const [owner, name] = path.split("/");
    return GET(new Request(`http://x/api/badge/${path}${query}`), { params: Promise.resolve({ owner, name }) });
  };

  it("renders an SVG for public repos", async () => {
    const res = await call("jan/rocket", "?metric=views&range=7");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain("views");
    expect(svg).toContain("170/week"); // range includes today: 5 days × 10 + 120 spike day
  });

  it("supports stars, visitors and custom labels", async () => {
    expect(await (await call("jan/rocket", "?metric=stars")).text()).toContain(">10<");
    expect(await (await call("jan/rocket", "?metric=visitors")).text()).toContain("60 /14d");
    expect(await (await call("jan/rocket", "?metric=clones&label=git%20clones")).text()).toContain("git clones");
  });

  it("hides private and unknown repos and rejects bad metrics", async () => {
    expect((await call("jan/secret", "?metric=stars")).status).toBe(404);
    expect((await call("jan/nope")).status).toBe(404);
    expect((await call("jan/rocket", "?metric=secrets")).status).toBe(400);
  });

  it("can be disabled", async () => {
    vi.stubEnv("BADGES_ENABLED", "false");
    expect((await call("jan/rocket")).status).toBe(404);
    vi.unstubAllEnvs();
  });
});
