/**
 * The site's main address: APP_URL, else the production domain Vercel provides on every deployment
 * (previews included), else nothing. Sign-in always happens here, because GitHub only accepts the
 * callback URLs registered on the App and the state cookie must live on that same domain.
 */
export function homeUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
}

/** Where GitHub sends people back after sign-in: the main address, else this request's origin (local dev). */
export function baseUrl(req: Request): string {
  return (homeUrl() ?? new URL(req.url).origin).replace(/\/$/, "");
}

export const callbackUrl = (req: Request) => `${baseUrl(req)}/api/auth/callback/github`;

/** Only same-site paths are allowed as a post-sign-in destination (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
