import { NextResponse, type NextRequest } from "next/server";
import { isAppMode } from "@/lib/app-mode";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session";

/** Public in both modes: cron has its own bearer secret; badges show public repos only. */
const ALWAYS_PUBLIC = ["/api/cron", "/api/badge"];
/** Public in sign-in mode: the landing page, the sign-in flow and the privacy note. */
const APP_PUBLIC = ["/api/auth", "/privacy", "/installed", "/icon.svg"];

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (ALWAYS_PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (isAppMode()) {
    // "/" shows the landing page when signed out and the dashboard when signed in (decided by the page)
    if (pathname === "/" || APP_PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
    const session = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET);
    if (session) return NextResponse.next();
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "sign in required" }, { status: 401 });
    const signin = new URL("/api/auth/signin", req.url);
    signin.searchParams.set("next", pathname + search);
    return NextResponse.redirect(signin);
  }

  // Single-user mode: optional HTTP basic auth
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [, pass] = atob(encoded).split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Repo Stats"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
