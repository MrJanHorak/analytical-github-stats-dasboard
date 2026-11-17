import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appConfig, isAppMode } from "@/lib/app-mode";
import { callbackUrl, homeUrl, safeNext } from "@/lib/auth-urls";
import { STATE_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Start "Sign in with GitHub": remember where to return and a CSRF state, then go to GitHub. */
export async function GET(req: Request) {
  if (!isAppMode()) return NextResponse.redirect(new URL("/", req.url));
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  // Preview/alias domains aren't registered callback URLs, and the state cookie must live on
  // the domain GitHub returns to. So start the sign-in on the main site.
  const home = homeUrl();
  if (home && new URL(home).origin !== new URL(req.url).origin) {
    return NextResponse.redirect(`${home}/api/auth/signin?next=${encodeURIComponent(next)}`);
  }
  const state = randomBytes(16).toString("base64url");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", appConfig().clientId);
  url.searchParams.set("redirect_uri", callbackUrl(req));
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, `${state}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
