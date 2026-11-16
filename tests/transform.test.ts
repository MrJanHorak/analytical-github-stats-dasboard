import { describe, expect, it } from "vitest";
import { compact, renderBadge } from "@/lib/badge";
import {
  aggregateContributedRepos,
  aggregateLanguages,
  bucket,
  ciStats,
  contributionStreaks,
  crossedMilestones,
  cumulativeByDay,
  dayRange,
  detectSpike,
  fillDaily,
  heatmapWeeks,
  isOutside,
  issueFlow,
  joinSeries,
  likelyAutomated,
  median,
  mergeTraffic,
  monthlyCodeFrequency,
  shortDuration,
  weeklyIssueFlow,
  pctChange,
  pivotReferrers,
  toCsv,
  topWithOther,
} from "@/lib/transform";
import { parseRange, rangeParam } from "@/lib/utils";

describe("mergeTraffic", () => {
  it("merges views and clones by UTC day and sorts", () => {
    const out = mergeTraffic(
      [
        { timestamp: "2026-11-02T00:00:00Z", count: 5, uniques: 2 },
        { timestamp: "2026-11-01T00:00:00Z", count: 3, uniques: 1 },
      ],
      [{ timestamp: "2026-11-02T00:00:00Z", count: 4, uniques: 4 }],
    );
    expect(out).toEqual([
      { date: "2026-11-01", views: 3, viewUniques: 1, clones: 0, cloneUniques: 0 },
      { date: "2026-11-02", views: 5, viewUniques: 2, clones: 4, cloneUniques: 4 },
    ]);
  });

  it("handles a day with only clones", () => {
    expect(mergeTraffic([], [{ timestamp: "2026-11-03T00:00:00Z", count: 1, uniques: 1 }])).toHaveLength(1);
  });
});

describe("dayRange / fillDaily", () => {
  it("is inclusive and crosses month boundaries", () => {
    expect(dayRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("zero-fills missing days", () => {
    const rows = [{ date: "2026-11-02", views: 7 }];
    expect(fillDaily(rows, "views", "2026-11-01", "2026-11-03")).toEqual([0, 7, 0]);
  });
});

describe("cumulativeByDay", () => {
  const ts = ["2026-01-01T10:00:00Z", "2026-11-01T01:00:00Z", "2026-11-01T23:00:00Z", "2026-11-03T12:00:00Z"];

  it("folds events before the window into the baseline", () => {
    expect(cumulativeByDay(ts, "2026-11-01", "2026-11-04")).toEqual([
      { date: "2026-11-01", value: 3 },
      { date: "2026-11-03", value: 4 },
      { date: "2026-11-04", value: 4 },
    ]);
  });

  it("returns flat endpoints when nothing happened", () => {
    expect(cumulativeByDay([], "2026-11-01", "2026-11-03")).toEqual([
      { date: "2026-11-01", value: 0 },
      { date: "2026-11-03", value: 0 },
    ]);
  });
});

describe("joinSeries", () => {
  it("carries values forward across a shared date axis", () => {
    const out = joinSeries({
      stars: [
        { date: "2026-11-01", value: 1 },
        { date: "2026-11-03", value: 2 },
      ],
      forks: [{ date: "2026-11-02", value: 5 }],
    });
    expect(out).toEqual([
      { date: "2026-11-01", stars: 1, forks: 0 },
      { date: "2026-11-02", stars: 1, forks: 5 },
      { date: "2026-11-03", stars: 2, forks: 5 },
    ]);
  });
});

describe("pivotReferrers", () => {
  it("pivots to neutral keys, zero-fills and ignores other referrers", () => {
    const out = pivotReferrers(
      [
        { date: "2026-11-02", referrer: "news.ycombinator.com", count: 5 },
        { date: "2026-11-01", referrer: "github.com", count: 3 },
        { date: "2026-11-02", referrer: "github.com", count: 4 },
        { date: "2026-11-02", referrer: "ignored.com", count: 99 },
      ],
      ["github.com", "news.ycombinator.com"],
    );
    expect(out.series).toEqual([
      { key: "r0", label: "github.com" },
      { key: "r1", label: "news.ycombinator.com" },
    ]);
    expect(out.data).toEqual([
      { date: "2026-11-01", r0: 3, r1: 0 },
      { date: "2026-11-02", r0: 4, r1: 5 },
    ]);
  });
});

describe("detectSpike", () => {
  const opts = { factor: 3, minValue: 25, minBaselineDays: 7 };
  const flat = Array(14).fill(10);

  it("flags a day at ≥ factor × the trailing mean", () => {
    expect(detectSpike([...flat, 30], opts)).toEqual({ spike: true, value: 30, baseline: 10 });
    expect(detectSpike([...flat, 29], opts).spike).toBe(false);
  });

  it("needs a minimum absolute value (no alerts for 0 → 3 views)", () => {
    expect(detectSpike([...Array(14).fill(0), 20], opts).spike).toBe(false);
    expect(detectSpike([...Array(14).fill(0), 25], opts).spike).toBe(true);
  });

  it("needs enough baseline history", () => {
    expect(detectSpike([1, 1, 1, 100], opts).spike).toBe(false);
  });
});

describe("crossedMilestones", () => {
  it("returns every milestone passed", () => {
    expect(crossedMilestones(9, 10, [10, 25])).toEqual([10]);
    expect(crossedMilestones(8, 30, [10, 25, 50])).toEqual([10, 25]);
    expect(crossedMilestones(10, 12, [10, 25])).toEqual([]);
    expect(crossedMilestones(30, 20, [25])).toEqual([]);
  });
});

describe("badge", () => {
  it("escapes label/message and sizes to content", () => {
    const svg = renderBadge('<script>"', "1.2k/month");
    expect(svg).toContain("&lt;script&gt;&quot;");
    expect(svg).not.toContain("<script>");
    expect(Number(/width="(\d+)"/.exec(svg)![1])).toBeGreaterThan(60);
  });

  it("compact", () => {
    expect([compact(999), compact(1234), compact(10_400), compact(1_250_000)]).toEqual(["999", "1.2k", "10k", "1.3M"]);
  });
});

describe("misc", () => {
  it("bucket sums into at most N points", () => {
    expect(bucket([1, 1, 1, 1, 1], 2)).toEqual([3, 2]);
    expect(bucket([1, 2], 10)).toEqual([1, 2]);
  });

  it("pctChange", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(5, 0)).toBeNull();
  });

  it("toCsv escapes quotes, commas and newlines", () => {
    expect(toCsv([{ a: 'x,"y"', b: null, c: new Date("2026-01-01T00:00:00Z") }])).toBe(
      'a,b,c\n"x,""y""",,2026-01-01T00:00:00.000Z\n',
    );
  });

  it("parseRange / rangeParam", () => {
    expect(parseRange(undefined)).toBe(30);
    expect(parseRange("all")).toBe(0);
    expect(parseRange("0")).toBe(0);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("13")).toBe(30);
    expect(rangeParam(0)).toBe("all");
  });
});

describe("aggregateLanguages / topWithOther", () => {
  const rows = [
    { repoId: 1, language: "TypeScript", bytes: 900 },
    { repoId: 2, language: "TypeScript", bytes: 100 },
    { repoId: 2, language: "CSS", bytes: 300 },
    { repoId: 3, language: "Shell", bytes: 50 },
  ];

  it("totals bytes and counts repos per language, largest first", () => {
    expect(aggregateLanguages(rows)).toEqual([
      { language: "TypeScript", bytes: 1000, repos: 2 },
      { language: "CSS", bytes: 300, repos: 1 },
      { language: "Shell", bytes: 50, repos: 1 },
    ]);
  });

  it("folds the tail into Other", () => {
    const all = aggregateLanguages(rows);
    expect(topWithOther(all, 1)).toEqual([all[0], { language: "Other", bytes: 350 }]);
    expect(topWithOther(all, 5)).toEqual(all);
  });
});

describe("likelyAutomated", () => {
  it("flags many clones with few views", () => {
    expect(likelyAutomated({ views: 3, clones: 40 })).toBe(true);
  });
  it("ignores small numbers and normal clone/view ratios", () => {
    expect(likelyAutomated({ views: 0, clones: 5 })).toBe(false);
    expect(likelyAutomated({ views: 200, clones: 40 })).toBe(false);
    expect(likelyAutomated({ views: 10, clones: 20 })).toBe(false);
  });
});

describe("contributionStreaks", () => {
  const d = (date: string, count = 1) => ({ date, count });
  it("finds the longest run and a current streak that may not include today yet", () => {
    const days = [d("2026-01-01"), d("2026-01-02"), d("2026-01-03"), d("2026-01-04", 0), d("2026-01-09"), d("2026-01-10")];
    expect(contributionStreaks(days, "2026-01-11")).toEqual({ current: 2, longest: 3, longestEnd: "2026-01-03" });
    expect(contributionStreaks(days, "2026-01-10")).toMatchObject({ current: 2 });
    expect(contributionStreaks(days, "2026-01-12")).toMatchObject({ current: 0 });
    expect(contributionStreaks([], "2026-01-12")).toEqual({ current: 0, longest: 0, longestEnd: null });
  });
  it("crosses month and year boundaries", () => {
    expect(contributionStreaks([d("2025-12-31"), d("2026-01-01")], "2026-01-01")).toMatchObject({ current: 2, longest: 2 });
  });
});

describe("heatmapWeeks", () => {
  it("lays out Sunday-first weeks ending with the week of `until`, with quartile levels", () => {
    // 2026-11-15 is a Sunday
    const weeks = heatmapWeeks([{ date: "2026-11-15", count: 8 }, { date: "2026-11-09", count: 2 }, { date: "2026-11-10", count: 7 }], "2026-11-15", 2);
    expect(weeks).toHaveLength(2);
    expect(weeks[0][0]!.date).toBe("2026-11-08");
    expect(weeks[0].map((c) => c!.level)).toEqual([0, 1, 4, 0, 0, 0, 0]);
    expect(weeks[1][0]).toEqual({ date: "2026-11-15", count: 8, level: 4 });
    expect(weeks[1].slice(1)).toEqual([null, null, null, null, null, null]); // the future
  });
});

describe("aggregateContributedRepos", () => {
  it("sums years per repo, flags your own repos and sorts busiest first", () => {
    const out = aggregateContributedRepos(
      [
        { repo: "jan/a", commits: 5, pullRequests: 0 },
        { repo: "other/b", commits: 2, pullRequests: 9 },
        { repo: "jan/a", commits: 1, pullRequests: 1 },
      ],
      "Jan",
    );
    expect(out).toEqual([
      { repo: "other/b", commits: 2, pullRequests: 9, own: false },
      { repo: "jan/a", commits: 6, pullRequests: 1, own: true },
    ]);
  });
});

describe("monthlyCodeFrequency", () => {
  it("buckets weeks into months with a running net total", () => {
    const jan5 = Date.UTC(2026, 0, 4) / 1000;
    const jan12 = Date.UTC(2026, 0, 11) / 1000;
    const feb1 = Date.UTC(2026, 1, 1) / 1000;
    expect(monthlyCodeFrequency([[jan5, 100, -10], [jan12, 50, 0], [feb1, 5, -45]])).toEqual([
      { date: "2026-01-01", additions: 150, deletions: 10, net: 140 },
      { date: "2026-02-01", additions: 5, deletions: 45, net: 100 },
    ]);
  });
});

const at = (s: string) => new Date(s + (s.length === 10 ? "T00:00:00Z" : "Z"));

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("issueFlow", () => {
  const item = (o: Partial<Parameters<typeof issueFlow>[0][number]>) => ({
    isPr: false,
    state: "open",
    author: "jan",
    authorAssociation: "OWNER",
    isBot: false,
    createdAt: at("2026-11-01"),
    closedAt: null,
    mergedAt: null,
    ...o,
  });
  const items = [
    item({ state: "closed", createdAt: at("2026-11-01T00:00:00"), closedAt: at("2026-11-01T10:00:00") }), // 10h
    item({ state: "closed", createdAt: at("2026-10-01"), closedAt: at("2026-11-03") }), // opened before range
    item({ author: "alice", authorAssociation: "NONE" }), // outside, open
    item({ isPr: true, author: "alice", authorAssociation: "CONTRIBUTOR", state: "closed", createdAt: at("2026-11-02T00:00:00"), mergedAt: at("2026-11-02T04:00:00"), closedAt: at("2026-11-02T04:00:00") }),
    item({ isPr: true, author: "bob", authorAssociation: "FIRST_TIME_CONTRIBUTOR", state: "closed", closedAt: at("2026-11-04") }), // closed unmerged
    item({ isPr: true, author: "dependabot[bot]", authorAssociation: "NONE", isBot: true }), // bot, open
    item({ createdAt: at("2026-09-01") }), // old open issue
  ];

  it("counts flow in range, current open items, medians and outside contributors", () => {
    expect(issueFlow(items, at("2026-11-01"))).toEqual({
      issuesOpened: 2,
      issuesClosed: 2,
      prsOpened: 3,
      prsMerged: 1,
      prsClosedUnmerged: 1,
      openIssues: 2,
      openPrs: 1,
      medianHoursToClose: (10 + 33 * 24) / 2,
      medianHoursToMerge: 4,
      outsideItems: 3,
      outsideContributors: [
        { login: "alice", count: 2 },
        { login: "bob", count: 1 },
      ],
      botItems: 1,
    });
  });

  it("treats bots and the team as not outside", () => {
    expect(isOutside({ authorAssociation: "NONE", isBot: true })).toBe(false);
    expect(isOutside({ authorAssociation: "COLLABORATOR", isBot: false })).toBe(false);
    expect(isOutside({ authorAssociation: "CONTRIBUTOR", isBot: false })).toBe(true);
  });

  it("buckets opened vs closed into Monday weeks", () => {
    // 2026-11-02 is a Monday
    expect(weeklyIssueFlow(items, "2026-11-02", "2026-11-15")).toEqual([
      { date: "2026-11-02", opened: 1, closed: 3 },
      { date: "2026-11-09", opened: 0, closed: 0 },
    ]);
  });
});

describe("ciStats", () => {
  const run = (workflow: string, conclusion: string | null, created: string, seconds = 60, status = "completed") => ({
    workflow,
    status,
    conclusion,
    createdAt: at(created),
    startedAt: at(created),
    updatedAt: new Date(at(created).getTime() + seconds * 1000),
  });
  it("computes pass rate without cancelled/skipped runs, durations and per-workflow stats", () => {
    const s = ciStats(
      [
        run("CI", "success", "2026-11-10", 100),
        run("CI", "failure", "2026-11-12", 300),
        run("CI", "cancelled", "2026-11-13", 5),
        run("CI", null, "2026-11-14", 0, "in_progress"),
        run("Deploy", "success", "2026-11-11", 40),
        run("CI", "failure", "2026-10-01"), // before range
      ],
      at("2026-11-01"),
    );
    expect(s).toMatchObject({ runs: 5, passed: 2, failed: 1, medianSeconds: 100 });
    expect(s.passRate).toBeCloseTo(2 / 3);
    expect(s.workflows.map((w) => [w.workflow, w.runs, w.passRate, w.last.conclusion])).toEqual([
      ["CI", 4, 0.5, "in_progress"],
      ["Deploy", 1, 1, "success"],
    ]);
    expect(s.recentFailures).toHaveLength(1);
    expect(ciStats([], at("2026-11-01")).passRate).toBeNull();
  });
});

describe("shortDuration", () => {
  it("picks minutes, hours or days", () => {
    expect(shortDuration(0.25)).toBe("15m");
    expect(shortDuration(5.04)).toBe("5h");
    expect(shortDuration(72)).toBe("3d");
    expect(shortDuration(null)).toBe("—");
  });
});
