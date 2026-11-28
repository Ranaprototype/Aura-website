/**
 * Phase 4 signed discovery cursors (application implementation of the contract
 * proven in phase-4-review-materials/validation/phase-4/cursor.test.ts).
 *
 * Contract (owner-approved D-22; plan §3.3):
 *   - The keyset position `k` MATCHES the actual query ordering for the sort:
 *       newest -> [approvedAtISO, slug]   (ORDER BY approved_at DESC, slug DESC)
 *       title  -> [title, slug]           (ORDER BY title ASC, slug ASC)
 *     No internal id is ever placed in a public cursor.
 *   - The cursor is BOUND to route + search term + filters + sort + page limit.
 *     Reusing a cursor under any different binding is rejected (invalid_cursor),
 *     even though the signature itself is valid.
 *   - Tampering, malformed payloads and wrong versions are rejected.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payloadB64)).
 * payload = { v: 1, b: <sha256(binding) hex>, k: [key0, key1] }.
 * Only node:crypto is used (no new dependency).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type SortOrder = "newest" | "title";

export interface CursorBinding {
  route: string; // logical route id, e.g. "products"
  q: string; // search term ("" when absent)
  category: string; // category slug filter ("" when absent)
  attr: string[]; // attribute filters as "key:value" (any order)
  sort: SortOrder; // sort order
  limit: number; // page limit
}

/** Keyset position. newest: [approvedAtISO, slug]; title: [title, slug]. */
export type CursorKey = [string, string];

export class InvalidCursor extends Error {
  constructor() {
    super("invalid_cursor");
    this.name = "InvalidCursor";
  }
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

/** Canonical, order-independent binding hash (route+q+category+attr+sort+limit). */
export function bindingHash(binding: CursorBinding): string {
  const canonical = JSON.stringify({
    route: binding.route,
    q: binding.q,
    category: binding.category,
    attr: [...binding.attr].sort(),
    sort: binding.sort,
    limit: binding.limit,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function hmac(secret: string, payloadB64: string): Buffer {
  return createHmac("sha256", secret).update(payloadB64).digest();
}

/** Issue a cursor for the given binding and keyset position. */
export function signCursor(
  binding: CursorBinding,
  key: CursorKey,
  secret: string
): string {
  const payload = { v: 1, b: bindingHash(binding), k: key };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${payloadB64}.${b64url(hmac(secret, payloadB64))}`;
}

/**
 * Verify a cursor against the CURRENT request binding. Returns the keyset
 * position on success; throws InvalidCursor on any tamper/mismatch/malformed.
 */
export function verifyCursor(
  token: string,
  binding: CursorBinding,
  secret: string
): CursorKey {
  if (typeof token !== "string") throw new InvalidCursor();
  const parts = token.split(".");
  if (parts.length !== 2) throw new InvalidCursor();
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) throw new InvalidCursor();

  let sig: Buffer;
  try {
    sig = Buffer.from(sigB64, "base64url");
  } catch {
    throw new InvalidCursor();
  }
  const expected = hmac(secret, payloadB64);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected))
    throw new InvalidCursor();

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursor();
  }
  if (typeof payload !== "object" || payload === null) throw new InvalidCursor();
  const { v, b, k } = payload as Record<string, unknown>;
  if (v !== 1) throw new InvalidCursor();
  if (typeof b !== "string") throw new InvalidCursor();
  if (
    !Array.isArray(k) ||
    k.length !== 2 ||
    typeof k[0] !== "string" ||
    typeof k[1] !== "string"
  )
    throw new InvalidCursor();

  // Binding check: a valid signature is NOT enough — the cursor must match the
  // current route/search/filters/sort/limit exactly.
  const expectedBinding = bindingHash(binding);
  const a = Buffer.from(b, "utf8");
  const c = Buffer.from(expectedBinding, "utf8");
  if (a.length !== c.length || !timingSafeEqual(a, c)) throw new InvalidCursor();

  return [k[0], k[1]];
}
