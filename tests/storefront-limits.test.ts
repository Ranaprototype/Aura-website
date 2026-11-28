/**
 * Phase 4 public limiter verification (plan §3.4): hashed IP buckets, isolated
 * storage, opportunistic pruning of windows older than one hour, and a bounded
 * in-memory fallback that keeps rate-limiting (never unlimited) when the limiter
 * query fails. Runs against the disposable engine for the storage paths and a
 * failing stub for the fallback path.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumePublicRead,
  prunePublicLimits,
  publicBucket,
} from "../server/modules/storefront/limits";
import type { Database } from "../server/db/database";
import { startTestDatabase, type TestDatabase } from "./support/database";

describe("publicBucket", () => {
  it("hashes the client IP and never retains the raw address", () => {
    const bucket = publicBucket("203.0.113.7");
    expect(bucket.startsWith("sf:")).toBe(true);
    expect(bucket).toHaveLength(35); // "sf:" + 32 hex chars
    expect(bucket).not.toContain("203.0.113.7");
    expect(publicBucket("203.0.113.7")).toBe(bucket); // deterministic
    expect(publicBucket("203.0.113.8")).not.toBe(bucket); // distinct per IP
  });
});

describe("public limiter storage", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await startTestDatabase();
  }, 60_000);
  afterAll(async () => {
    await database?.close();
  });

  it("stores a hashed bucket, increments within the window, and denies over limit", async () => {
    const ip = "192.0.2.44";
    const first = await consumePublicRead(database.publicDb, ip, 3);
    expect(first.allowed).toBe(true);
    const rows = await database.admin.query<{ bucket: string; hits: number }>(
      `select bucket, hits from aura.public_rate_limits where bucket = $1`,
      [publicBucket(ip)]
    );
    expect(rows[0]?.bucket).toBe(publicBucket(ip));
    expect(rows[0]?.bucket.startsWith("sf:")).toBe(true);
    expect(rows[0]?.hits).toBe(1);
    expect((await consumePublicRead(database.publicDb, ip, 3)).allowed).toBe(true);
    expect((await consumePublicRead(database.publicDb, ip, 3)).allowed).toBe(true);
    const denied = await consumePublicRead(database.publicDb, ip, 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("prunes windows older than one hour and keeps recent ones", async () => {
    await database.admin.query(
      `insert into aura.public_rate_limits (bucket, window_start, hits) values
        ('sf:old-row', now() - interval '2 hours', 5),
        ('sf:recent-row', date_trunc('minute', now()), 1)`
    );
    await prunePublicLimits(database.publicDb);
    const remaining = await database.admin.query<{ bucket: string }>(
      `select bucket from aura.public_rate_limits where bucket in ('sf:old-row','sf:recent-row') order by bucket`
    );
    expect(remaining.map(r => r.bucket)).toEqual(["sf:recent-row"]);
  });
});

describe("public limiter fallback (limiter query failure)", () => {
  const failingDb = {
    query: async () => {
      throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    },
  } as unknown as Database;

  it("keeps rate-limiting with the same limit and warns — never unlimited", async () => {
    const warnings: string[] = [];
    const ip = "198.51.100.23";
    const limit = 3;
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      const result = await consumePublicRead(failingDb, ip, limit, event => warnings.push(event));
      if (result.allowed) allowed++;
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    }
    expect(allowed).toBe(limit); // exactly the budget, never unlimited
    expect(warnings.length).toBe(10);
    expect(warnings.every(w => w === "public_limiter_fallback")).toBe(true);
  });

  it("isolates fallback buckets per IP", async () => {
    const a = await consumePublicRead(failingDb, "198.51.100.200", 1);
    const b = await consumePublicRead(failingDb, "198.51.100.201", 1);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    const aAgain = await consumePublicRead(failingDb, "198.51.100.200", 1);
    expect(aAgain.allowed).toBe(false);
  });
});
