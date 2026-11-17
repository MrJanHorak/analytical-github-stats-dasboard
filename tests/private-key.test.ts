import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePrivateKey } from "../src/lib/private-key";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("normalizePrivateKey", () => {
  const forms: Record<string, string> = {
    "PKCS#1 as downloaded": pkcs1,
    "PKCS#8": pkcs8,
    "literal \\n": pkcs1.replace(/\n/g, "\\n"),
    "Windows line endings": pkcs1.replace(/\n/g, "\r\n"),
    "one line with spaces": pkcs1.replace(/\n/g, " "),
    "wrapped in quotes": `"${pkcs1}"`,
    "base64 of the file": Buffer.from(pkcs1).toString("base64"),
  };
  for (const [name, raw] of Object.entries(forms)) {
    it(`accepts ${name}`, () => expect(normalizePrivateKey(raw)).toBe(pkcs8));
  }
  it("explains a broken key", () => {
    expect(() => normalizePrivateKey("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toThrow(/whole \.pem/);
    expect(() => normalizePrivateKey("Iv23li2o9EL2X2Wrf7eH")).toThrow(/whole \.pem/);
  });
});
