/**
 * Phase 4 public read rate limiter — ISOLATED from the auth limiter (plan §3.4,
 * §4.10). Anonymous traffic can only ever touch `aura.public_rate_limits`; it
 * cannot inflate login/registration/recovery counters, and auth pruning never
 * deletes it. Fixed one-minute window per client IP, keyed by a HASHED bucket
 * (`sf:<sha256(ip)[:32]>`) so the table never retains raw client addresses.
 * Runs on the public pool (aura_public has CRUD on this one table only).
 *
 * Resilience (plan §3.4): windows older than one hour are pruned opportunistically
 * via the public pool; if the limiter query fails, a bounded per-instance
 * in-memory counter with the SAME limit takes over and a warning is logged —
 * never unlimited, and never a full browsing outage caused by the limiter.
 */
import { createHash } from "node:crypto";
import type { Database } from "../../db/database";

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfter: number;
}

const WINDOW_MS = 60_000;

/** Plan §3.4: the bucket is a hashed client IP, never the raw address. */
export const publicBucket = (ip: string): string =>
  `sf:${createHash("sha256").update(ip).digest("hex").slice(0, 32)}`;

// Per-instance fallback counters, used ONLY when the limiter query fails. Bounded
// so a flood of distinct buckets cannot exhaust memory during a DB outage.
const fallbackCounters = new Map<string, { window: number; hits: number }>();
const FALLBACK_MAX_BUCKETS = 10_000;

function fallbackHit(bucket: string, limit: number): LimitResult {
  const now = Date.now();
  const window = Math.floor(now / WINDOW_MS);
  if (fallbackCounters.size > FALLBACK_MAX_BUCKETS) {
    fallbackCounters.forEach((value, key) => {
      if (value.window < window) fallbackCounters.delete(key);
    });
    if (fallbackCounters.size > FALLBACK_MAX_BUCKETS) fallbackCounters.clear();
  }
  const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now % WINDOW_MS)) / 1000));
  const entry = fallbackCounters.get(bucket);
  if (!entry || entry.window < window) {
    fallbackCounters.set(bucket, { window, hits: 1 });
    return { allowed: true, retryAfter };
  }
  entry.hits += 1;
  return { allowed: entry.hits <= limit, retryAfter };
}

/**
 * Opportunistic prune of windows older than one hour (plan §3.4). Exported for
 * direct verification; the consume path throttles it to once per minute per
 * instance so it never runs on every request.
 */
export async function prunePublicLimits(db: Database): Promise<void> {
  await db.query(
    `delete from aura.public_rate_limits where window_start < now() - interval '1 hour'`
  );
}

let lastPruneMs = 0;
const PRUNE_INTERVAL_MS = 60_000;

/**
 * Consume one hit for the IP. Returns whether the request is within budget.
 * The caller maps a denial to 429 + Retry-After. `req.ip` respects the
 * configured trust-proxy setting (default OFF => socket peer, so a spoofed
 * X-Forwarded-For cannot evade the limiter). On limiter failure, falls back to
 * the bounded in-memory counter (still rate-limited) and invokes `onWarn`.
 */
export async function consumePublicRead(
  db: Database,
  ip: string,
  limit: number,
  onWarn?: (event: string, fields: Record<string, unknown>) => void
): Promise<LimitResult> {
  const bucket = publicBucket(ip);
  try {
    const rows = await db.query<{ hits: number; retry: number }>(
      `insert into aura.public_rate_limits (bucket, window_start, hits)
       values ($1, date_trunc('minute', now()), 1)
       on conflict (bucket, window_start)
       do update set hits = aura.public_rate_limits.hits + 1
       returning hits,
               greatest(1, ceil(60 - extract(second from now())))::int as retry`,
      [bucket]
    );
    const now = Date.now();
    if (now - lastPruneMs >= PRUNE_INTERVAL_MS) {
      lastPruneMs = now;
      // Best-effort: a prune failure must not break the read path.
      await prunePublicLimits(db).catch(() => undefined);
    }
    const row = rows[0];
    if (!row) return { allowed: true, retryAfter: 1 };
    return { allowed: row.hits <= limit, retryAfter: row.retry };
  } catch (error) {
    onWarn?.("public_limiter_fallback", {
      reason: (error as { code?: string }).code ?? "error",
    });
    return fallbackHit(bucket, limit);
  }
}
