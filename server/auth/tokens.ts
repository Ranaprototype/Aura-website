import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 256 bits of entropy, URL safe: used for sessions, CSRF and one-time links. */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function tokenMatches(token: string | undefined, hash: Buffer): boolean {
  if (typeof token !== "string" || token.length < 16 || token.length > 200)
    return false;
  const digest = hashToken(token);
  return digest.length === hash.length && timingSafeEqual(digest, hash);
}

export function sameToken(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Cheap, non-reversible device hint for the session table. */
export function fingerprint(value: string | undefined): Buffer {
  return createHash("sha256").update(value ?? "", "utf8").digest().subarray(0, 16);
}
