/**
 * Phase 4 planning validation — EXECUTABLE cursor tests (owner item 2).
 *
 * Run: node --import tsx --test validation/phase-4/cursor.test.ts
 *
 * Two layers:
 *   (A) Pure cursor contract tests (no DB): round-trip, tampering, mismatched
 *       route/search/filters/sort/limit, malformed payloads, attr-order independence.
 *   (B) Pagination coverage on disposable PGlite (real 0001-0007 + proposed 0008):
 *       page through the public projection with the EXACT list SQL + signed cursor
 *       and assert no duplicates and no omissions, for newest sort, title sort and
 *       a search term. The keyset preserves full timestamp precision (approved_at::text).
 *
 * Disposable only; nothing here is applied to the real ledger or the app.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  signCursor, verifyCursor, InvalidCursor, bindingHash,
  type CursorBinding, type CursorKey,
} from "./cursor.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const migrationsDir = path.join(root, "supabase/migrations");
const proposedDir = path.join(root, "validation/phase-4/proposed");
const SECRET = "validation-only-cursor-secret-0123456789abcdef";

const base: CursorBinding = { route: "products", q: "", category: "", attr: [], sort: "newest", limit: 3 };
const key: CursorKey = ["2026-11-20 12:00:00.123456+00", "prod-3"];

// ---- (A) pure contract tests ------------------------------------------------
test("A1 round-trip: sign then verify with the same binding returns the key", () => {
  const token = signCursor(base, key, SECRET);
  assert.deepEqual(verifyCursor(token, base, SECRET), key);
});

test("A2 tampered payload is rejected", () => {
  const token = signCursor(base, key, SECRET);
  const [p, s] = token.split(".");
  const flipped = (p[0] === "A" ? "B" : "A") + p.slice(1);
  assert.throws(() => verifyCursor(`${flipped}.${s}`, base, SECRET), InvalidCursor);
});

test("A3 tampered signature is rejected", () => {
  const token = signCursor(base, key, SECRET);
  const [p, s] = token.split(".");
  const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
  assert.throws(() => verifyCursor(`${p}.${flipped}`, base, SECRET), InvalidCursor);
});

test("A4 wrong secret is rejected", () => {
  const token = signCursor(base, key, SECRET);
  assert.throws(() => verifyCursor(token, base, "a-different-secret"), InvalidCursor);
});

test("A5 mismatched route is rejected", () => {
  const token = signCursor(base, key, SECRET);
  assert.throws(() => verifyCursor(token, { ...base, route: "other" }, SECRET), InvalidCursor);
});

test("A6 mismatched search term is rejected", () => {
  const token = signCursor(base, key, SECRET);
  assert.throws(() => verifyCursor(token, { ...base, q: "shoes" }, SECRET), InvalidCursor);
});

test("A7 mismatched category filter is rejected", () => {
  const token = signCursor(base, key, SECRET);
  assert.throws(() => verifyCursor(token, { ...base, category: "apparel" }, SECRET), InvalidCursor);
});

test("A8 mismatched attribute filter is rejected", () => {
  const token = signCursor({ ...base, attr: ["upper-material:knit"] }, key, SECRET);
  assert.throws(() => verifyCursor(token, { ...base, attr: ["upper-material:leather"] }, SECRET), InvalidCursor);
});

test("A9 mismatched sort order is rejected", () => {
  const token = signCursor(base, key, SECRET);
  assert.throws(() => verifyCursor(token, { ...base, sort: "title" }, SECRET), InvalidCursor);
});

test("A10 mismatched page limit is rejected", () => {
  const token = signCursor(base, key, SECRET);
  assert.throws(() => verifyCursor(token, { ...base, limit: 60 }, SECRET), InvalidCursor);
});

test("A11 attribute order does not change the binding (canonical hash)", () => {
  const a = bindingHash({ ...base, attr: ["b:2", "a:1"] });
  const b = bindingHash({ ...base, attr: ["a:1", "b:2"] });
  assert.equal(a, b);
  const token = signCursor({ ...base, attr: ["b:2", "a:1"] }, key, SECRET);
  assert.deepEqual(verifyCursor(token, { ...base, attr: ["a:1", "b:2"] }, SECRET), key);
});

test("A12 malformed payloads are rejected", () => {
  const malformed = [
    "", "no-dot", ".", "a.", ".b", "!!!.@@@",
    Buffer.from("not json").toString("base64url") + "." + "x",
  ];
  for (const m of malformed) assert.throws(() => verifyCursor(m, base, SECRET), InvalidCursor);
  // valid signature but wrong shape
  const mk = (obj: unknown) => {
    const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
    return `${p}.${createHmac("sha256", SECRET).update(p).digest("base64url")}`;
  };
  assert.throws(() => verifyCursor(mk({ v: 2, b: bindingHash(base), k: key }), base, SECRET), InvalidCursor);
  assert.throws(() => verifyCursor(mk({ v: 1, b: bindingHash(base), k: ["only-one"] }), base, SECRET), InvalidCursor);
  assert.throws(() => verifyCursor(mk({ v: 1, b: bindingHash(base), k: [1, 2] }), base, SECRET), InvalidCursor);
  assert.throws(() => verifyCursor(mk({ v: 1, k: key }), base, SECRET), InvalidCursor);
});

// ---- (B) pagination coverage on PGlite --------------------------------------
let db: PGlite;
const q = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as Record<string, any>[];
const exec = (sql: string) => db.exec(sql);
async function unit<T>(role: string, principal: string | null, fn: () => Promise<T>): Promise<T> {
  await q("begin");
  try {
    await q(`set local role ${role}`);
    if (principal) await q("select set_config('aura.principal_id', $1, true)", [principal]);
    const out = await fn();
    await q("commit");
    return out;
  } catch (e) {
    await q("rollback");
    throw e;
  }
}

before(async () => {
  db = new PGlite();
  await db.waitReady;
  const files = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort();
  for (const f of files) await exec(await readFile(path.join(migrationsDir, f), "utf8"));
  const mk = async (k: string, e: string) =>
    (await q(`insert into aura.principals (issuer, subject, email, email_verified_at) values ('local',$1,$2,now()) returning id`, [k, e]))[0].id;
  const owner = await mk("owner", "owner@x.test");
  const admin = await mk("admin", "admin@x.test");
  const org = (await unit("aura_app", owner, () => q(`select (aura.create_organization('Org','org')).id as id`)))[0].id;
  await q(`insert into aura.platform_admins (principal_id) values ($1)`, [admin]);
  const seller = (await unit("aura_app", owner, () =>
    q(`insert into aura.seller_profiles (org_id,display_name,legal_name,business_email,country,created_by) values ($1,'S','S Legal','s@x.test','IN',$2) returning id`, [org, owner])))[0].id;
  await unit("aura_app", owner, () => q(`update aura.seller_profiles set status='submitted' where id=$1`, [seller]));
  await unit("aura_app", admin, () => q(`update aura.seller_profiles set status='approved' where id=$1`, [seller]));
  const sneakers = (await q(`select id from aura.categories where slug='sneakers'`))[0].id;
  const upperMaterial = (await q(`select id from aura.category_attributes where category_id=$1 and key='upper-material'`, [sneakers]))[0].id;
  // catalog owner + proposed 0008 (definer views)
  await q(`create role aura_catalog_owner nologin nosuperuser nobypassrls nocreaterole nocreatedb`);
  await q(`alter schema aura owner to aura_catalog_owner`);
  for (const t of ["products", "seller_profiles", "product_variants", "product_media", "product_attribute_values", "categories", "category_attributes"])
    await q(`alter table aura.${t} owner to aura_catalog_owner`);
  await exec(await readFile(path.join(proposedDir, "0008_public_storefront.sql"), "utf8"));
  // 7 approved products
  for (let i = 0; i < 7; i++) {
    const pid = (await unit("aura_app", owner, () =>
      q(`insert into aura.products (org_id,seller_profile_id,category_id,slug,title,created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
        [org, seller, sneakers, `prod-${i}`, `Product ${i}`, owner])))[0].id;
    // furnish (variant + image media + attribute) so the product is complete for submission
    await unit("aura_app", owner, async () => {
      await q(`insert into aura.product_variants (org_id,product_id,sku,title,size,colour,created_by) values ($1,$2,$3,'Standard','42','black',$4)`, [org, pid, `SKU-${i}`, owner]);
      await q(`insert into aura.product_media (org_id,product_id,kind,url,alt_text,created_by) values ($1,$2,'image','https://images.example.test/p.jpg','Photo',$3)`, [org, pid, owner]);
      await q(`insert into aura.product_attribute_values (org_id,product_id,attribute_id,value) values ($1,$2,$3,'knit')`, [org, pid, upperMaterial]);
    });
    const rev = (await unit("aura_app", owner, async () => {
      const r = await q(`insert into aura.product_revisions (product_id,org_id,submitted_by) values ($1,$2,$3) returning id`, [pid, org, owner]);
      await q(`update aura.products set status='submitted' where id=$1`, [pid]);
      return r;
    }))[0].id;
    await unit("aura_app", admin, async () => {
      await q(`update aura.product_revisions set decision='approved' where id=$1`, [rev]);
      await q(`update aura.products set status='approved', approved_revision_id=$2 where id=$1`, [pid, rev]);
    });
  }
  // Stagger approved_at by days (distinct, full precision) for a meaningful keyset.
  await exec(`alter table aura.products disable trigger products_guard; alter table aura.products disable trigger products_touch;`);
  for (let i = 0; i < 7; i++)
    await q(`update aura.products set approved_at = now() - ($1||' days')::interval where slug=$2`, [String(7 - i), `prod-${i}`]);
  await exec(`alter table aura.products enable trigger products_guard; alter table aura.products enable trigger products_touch;`);
});

after(async () => { await db?.close(); });

test("B1 newest-sort pagination: no duplicates, no omissions, correct order", async () => {
  const binding = { ...base, sort: "newest" as const, limit: 3 };
  const expected = (await q(`select slug from aura.public_products order by approved_at desc, slug desc`)).map(r => r.slug);
  // keyset cmp uses the second cursor param via a subquery binding; here we pass k0/k1 through the cursor
  const collected: string[] = [];
  let ck: CursorKey | null = null;
  for (let page = 0; page < 50; page++) {
    const rows = await unit("aura_public", null, () =>
      q(`select p.slug, p.approved_at::text as k0 from aura.public_products p
         where ($1::timestamptz is null or (p.approved_at, p.slug) < ($1, $2))
         order by p.approved_at desc, p.slug desc limit $3`,
        [ck ? ck[0] : null, ck ? ck[1] : null, binding.limit]));
    if (!rows.length) break;
    collected.push(...rows.map(r => r.slug));
    const last = rows[rows.length - 1];
    ck = verifyCursor(signCursor(binding, [last.k0, last.slug], SECRET), binding, SECRET);
    if (rows.length < binding.limit) break;
  }
  assert.deepEqual(collected, expected);
  assert.equal(new Set(collected).size, collected.length, "no duplicates");
  assert.equal(collected.length, 7, "no omissions");
});

test("B2 title-sort pagination: no duplicates, no omissions, correct order", async () => {
  const binding = { ...base, sort: "title" as const, limit: 2 };
  const expected = (await q(`select slug from aura.public_products order by title asc, slug asc`)).map(r => r.slug);
  const collected: string[] = [];
  let ck: CursorKey | null = null;
  for (let page = 0; page < 50; page++) {
    const rows = await unit("aura_public", null, () =>
      q(`select p.slug, p.title as k0 from aura.public_products p
         where ($1::text is null or (p.title, p.slug) > ($1, $2))
         order by p.title asc, p.slug asc limit $3`,
        [ck ? ck[0] : null, ck ? ck[1] : null, binding.limit]));
    if (!rows.length) break;
    collected.push(...rows.map(r => r.slug));
    const last = rows[rows.length - 1];
    ck = verifyCursor(signCursor(binding, [last.k0, last.slug], SECRET), binding, SECRET);
    if (rows.length < binding.limit) break;
  }
  assert.deepEqual(collected, expected);
  assert.equal(new Set(collected).size, collected.length, "no duplicates");
  assert.equal(collected.length, 7, "no omissions");
});

test("B3 search-bound pagination: cursor bound to the search term, full coverage", async () => {
  const binding = { ...base, q: "product", sort: "newest" as const, limit: 3 };
  const expected = (await q(`select slug from aura.public_products
     where to_tsvector('simple', title || ' ' || coalesce(summary,'')) @@ websearch_to_tsquery('simple','product')
     order by approved_at desc, slug desc`)).map(r => r.slug);
  const collected: string[] = [];
  let ck: CursorKey | null = null;
  for (let page = 0; page < 50; page++) {
    const rows = await unit("aura_public", null, () =>
      q(`select p.slug, p.approved_at::text as k0 from aura.public_products p
         where to_tsvector('simple', p.title || ' ' || coalesce(p.summary,'')) @@ websearch_to_tsquery('simple', $1)
           and ($2::timestamptz is null or (p.approved_at, p.slug) < ($2, $3))
         order by p.approved_at desc, p.slug desc limit $4`,
        [binding.q, ck ? ck[0] : null, ck ? ck[1] : null, binding.limit]));
    if (!rows.length) break;
    collected.push(...rows.map(r => r.slug));
    const last = rows[rows.length - 1];
    ck = verifyCursor(signCursor(binding, [last.k0, last.slug], SECRET), binding, SECRET);
    if (rows.length < binding.limit) break;
  }
  assert.deepEqual(collected, expected);
  assert.equal(collected.length, 7);
  // A cursor issued for q="product" must NOT be reusable for a different term.
  const token = signCursor(binding, ["2026-11-20 00:00:00+00", "prod-6"], SECRET);
  assert.throws(() => verifyCursor(token, { ...binding, q: "other" }, SECRET), InvalidCursor);
});

test("B4 a cursor cannot jump between sorts (newest cursor rejected under title sort)", async () => {
  const newest = { ...base, sort: "newest" as const };
  const title = { ...base, sort: "title" as const };
  const token = signCursor(newest, ["2026-11-20 00:00:00+00", "prod-6"], SECRET);
  assert.throws(() => verifyCursor(token, title, SECRET), InvalidCursor);
});
