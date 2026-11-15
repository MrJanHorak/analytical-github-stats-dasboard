import { NextResponse, type NextRequest } from "next/server";

/** Optional HTTP basic auth for the dashboard. Cron route uses its own bearer secret. */
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  const { pathname } = req.nextUrl;
  // Cron has its own bearer secret; badges are public by design (public repos only).
  if (!password || pathname.startsWith("/api/cron") || pathname.startsWith("/api/badge")) return NextResponse.next();

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
