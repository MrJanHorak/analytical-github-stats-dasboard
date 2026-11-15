import { describe, expect, it } from "vitest";
import { bucket, cumulativeByDay, dayRange, fillDaily, joinSeries, mergeTraffic, pctChange, pivotReferrers, toCsv } from "@/lib/transform";
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
