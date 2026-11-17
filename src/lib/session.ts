import { jwtVerify, SignJWT } from "jose";

/**
 * Signed session cookie (HS256 JWT keyed by AUTH_SECRET). Holds who you are, not GitHub tokens.
 * Edge-safe, so middleware can check it without a database round-trip.
 */
export const SESSION_COOKIE = "rs_session";
export const STATE_COOKIE = "rs_oauth_state";
export const SESSION_DAYS = 30;

export type Session = { userId: number; login: string; avatarUrl: string | null };

const keyFor = (secret: string) => new TextEncoder().encode(`session:${secret}`);

export async function createSessionToken(s: Session, secret: string): Promise<string> {
  return new SignJWT({ login: s.login, avatarUrl: s.avatarUrl })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(s.userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(keyFor(secret));
}

/** The session in a cookie value, or null if missing, expired or not signed by us. */
export async function readSessionToken(token: string | undefined, secret: string | undefined): Promise<Session | null> {
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, keyFor(secret), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    if (!Number.isFinite(userId) || typeof payload.login !== "string") return null;
    return { userId, login: payload.login, avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : null };
  } catch {
    return null;
  }
}
