import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets at rest (users' GitHub refresh tokens). The key is derived from
 * AUTH_SECRET, so rotating AUTH_SECRET makes stored tokens unreadable — users then just sign in again.
 */
const key = (secret: string) => createHash("sha256").update(`token-encryption:${secret}`).digest();

export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Null when the value was tampered with or encrypted with a different secret. */
export function decrypt(enc: string, secret: string): string | null {
  const [v, iv, tag, body] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !body) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
