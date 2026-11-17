import { describe, expect, it } from "vitest";
import { homeUrl, safeNext } from "@/lib/auth-urls";
import { decrypt, encrypt } from "@/lib/crypto";
import { createSessionToken, readSessionToken } from "@/lib/session";

describe("token encryption", () => {
  it("round-trips, and rejects tampering or another secret", () => {
    const enc = encrypt("ghr_secret-refresh-token", "s3cret");
    expect(enc).not.toContain("ghr_");
    expect(decrypt(enc, "s3cret")).toBe("ghr_secret-refresh-token");
    expect(decrypt(enc, "other")).toBeNull();
    const parts = enc.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(decrypt(parts.join("."), "s3cret")).toBeNull();
    expect(decrypt("garbage", "s3cret")).toBeNull();
    expect(encrypt("x", "s3cret")).not.toBe(encrypt("x", "s3cret")); // random IV
  });
});

describe("session cookie", () => {
  it("signs and verifies; rejects other secrets, tampering and missing values", async () => {
    const t = await createSessionToken({ userId: 42, login: "jan", avatarUrl: "https://a/u/42" }, "s3cret");
    expect(await readSessionToken(t, "s3cret")).toEqual({ userId: 42, login: "jan", avatarUrl: "https://a/u/42" });
    expect(await readSessionToken(t, "other")).toBeNull();
    expect(await readSessionToken(t.slice(0, -3) + "abc", "s3cret")).toBeNull();
    expect(await readSessionToken(undefined, "s3cret")).toBeNull();
    expect(await readSessionToken(t, undefined)).toBeNull();
  });
});

describe("safeNext", () => {
  it("only allows same-site paths", () => {
    expect(safeNext("/repo/jan/x?range=30")).toBe("/repo/jan/x?range=30");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("homeUrl", () => {
  it("prefers APP_URL, then Vercel's production domain", () => {
    expect(homeUrl({ APP_URL: "https://x.dev/", VERCEL_PROJECT_PRODUCTION_URL: "y.vercel.app" })).toBe("https://x.dev");
    expect(homeUrl({ VERCEL_PROJECT_PRODUCTION_URL: "y.vercel.app" })).toBe("https://y.vercel.app");
    expect(homeUrl({})).toBeNull();
  });
});
