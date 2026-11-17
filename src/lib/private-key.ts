import { createPrivateKey } from "node:crypto";

/**
 * Turn GITHUB_APP_PRIVATE_KEY into a clean PKCS#8 PEM, whatever way it was pasted: with real
 * newlines, literal "\n", Windows line endings, all on one line, wrapped in quotes, or as the
 * base64 of the whole .pem file. GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY"); the JWT
 * library behind @octokit/auth-app is happiest with PKCS#8, so convert.
 */
export function normalizePrivateKey(raw: string): string {
  let s = raw.trim().replace(/^["']|["']$/g, "").replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\r/g, "");
  if (!s.includes("-----BEGIN")) {
    const decoded = Buffer.from(s.replace(/\s+/g, ""), "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) s = decoded;
  }
  const m = s.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  if (m) {
    const body = m[2].replace(/\s+/g, "");
    s = `-----BEGIN ${m[1]}-----\n${(body.match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${m[1]}-----\n`;
  }
  try {
    return createPrivateKey(s).export({ type: "pkcs8", format: "pem" }).toString();
  } catch {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY isn't a readable private key. Paste the whole .pem file from the GitHub App settings, including the BEGIN and END lines.",
    );
  }
}
