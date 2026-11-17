/** Where GitHub sends people back after sign-in. APP_URL wins (behind proxies), else the request's origin. */
export function baseUrl(req: Request): string {
  return (process.env.APP_URL?.replace(/\/$/, "") || new URL(req.url).origin).replace(/\/$/, "");
}

export const callbackUrl = (req: Request) => `${baseUrl(req)}/api/auth/callback/github`;

/** Only same-site paths are allowed as a post-sign-in destination (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
