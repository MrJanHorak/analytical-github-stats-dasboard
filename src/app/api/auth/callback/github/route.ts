import { NextResponse } from "next/server";
import { appConfig, isAppMode } from "@/lib/app-mode";
import { callbackUrl, safeNext } from "@/lib/auth-urls";
import { exchangeCode, fetchUserAndInstallations } from "@/lib/github-app";
import { createSessionToken, SESSION_COOKIE, SESSION_DAYS, STATE_COOKIE } from "@/lib/session";
import { recordSignIn } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * GitHub sends people back here after they approve sign-in. Check the CSRF state, swap the code
 * for user tokens, store the user + which App installations they can see, and set the session.
 */
export async function GET(req: Request) {
  if (!isAppMode()) return NextResponse.redirect(new URL("/", req.url));
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = req.headers.get("cookie")?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];
  const [expected, next] = decodeURIComponent(cookie ?? "").split("|");
  const fail = (reason: string) => NextResponse.redirect(new URL(`/?signin_error=${encodeURIComponent(reason)}`, req.url));

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") ?? "GitHub sign-in was cancelled");
  if (!code || !state || !expected || state !== expected) return fail("Sign-in expired — please try again");

  try {
    const tokens = await exchangeCode(code, callbackUrl(req));
    const { user, installations } = await fetchUserAndInstallations(tokens.accessToken);
    await recordSignIn(user, tokens, installations);
    const session = await createSessionToken({ userId: user.id, login: user.login, avatarUrl: user.avatarUrl }, appConfig().authSecret);
    const res = NextResponse.redirect(new URL(safeNext(next), req.url));
    res.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 86_400,
    });
    res.cookies.delete(STATE_COOKIE);
    return res;
  } catch (e) {
    console.error("sign-in failed", e);
    return fail("Sign-in failed — please try again");
  }
}
