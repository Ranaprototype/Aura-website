/**
 * Phase 4 signed-cursor verification against the IMPLEMENTATION module
 * (server/modules/storefront/cursor.ts). Ports the executed planning-validation
 * cases (phase-4-review-materials/validation/phase-4/cursor.test.ts):
 *   (A) pure contract — round-trip, tampering, mismatched binding, malformed;
 *   (B) keyset pagination coverage on the disposable engine with the real
 *       discovery views, asserting no duplicates and no omissions per sort.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  bindingHash,
  InvalidCursor,
  signCursor,
  verifyCursor,
  type CursorBinding,
  type CursorKey,
} from "../server/modules/storefront/cursor";
import { startTestDatabase, type TestDatabase } from "./support/database";

const SECRET = "implementation-cursor-secret-0123456789abcdef";
const base: CursorBinding = {
  route: "products", q: "", category: "", attr: [], sort: "newest", limit: 3,
};
const key: CursorKey = ["2026-11-20 12:00:00.123456+00", "prod-3"];

describe("cursor contract (A)", () => {
  it("A1 round-trips a signed cursor under the same binding", () => {
    expect(verifyCursor(signCursor(base, key, SECRET), base, SECRET)).toEqual(key);
  });

  it("A2 rejects a tampered payload", () => {
    const [p, s] = signCursor(base, key, SECRET).split(".");
    const flipped = (p![0] === "A" ? "B" : "A") + p!.slice(1);
    expect(() => verifyCursor(`${flipped}.${s}`, base, SECRET)).toThrow(InvalidCursor);
  });

  it("A3 rejects a tampered signature", () => {
    const [p, s] = signCursor(base, key, SECRET).split(".");
    const flipped = (s![0] === "A" ? "B" : "A") + s!.slice(1);
    expect(() => verifyCursor(`${p}.${flipped}`, base, SECRET)).toThrow(InvalidCursor);
  });

  it("A4 rejects a wrong secret", () => {
    expect(() => verifyCursor(signCursor(base, key, SECRET), base, "another-secret")).toThrow(InvalidCursor);
  });

  it("A5–A10 reject any mismatched binding field", () => {
    const token = signCursor(base, key, SECRET);
    expect(() => verifyCursor(token, { ...base, route: "other" }, SECRET)).toThrow(InvalidCursor);
    expect(() => verifyCursor(token, { ...base, q: "shoes" }, SECRET)).toThrow(InvalidCursor);
    expect(() => verifyCursor(token, { ...base, category: "apparel" }, SECRET)).toThrow(InvalidCursor);
    expect(() => verifyCursor(token, { ...base, sort: "title" }, SECRET)).toThrow(InvalidCursor);
    expect(() => verifyCursor(token, { ...base, limit: 60 }, SECRET)).toThrow(InvalidCursor);
    const attrToken = signCursor({ ...base, attr: ["upper-material:knit"] }, key, SECRET);
    expect(() => verifyCursor(attrToken, { ...base, attr: ["upper-material:leather"] }, SECRET)).toThrow(InvalidCursor);
  });

  it("A11 attribute order does not change the binding", () => {
    expect(bindingHash({ ...base, attr: ["b:2", "a:1"] })).toBe(bindingHash({ ...base, attr: ["a:1", "b:2"] }));
    const token = signCursor({ ...base, attr: ["b:2", "a:1"] }, key, SECRET);
    expect(verifyCursor(token, { ...base, attr: ["a:1", "b:2"] }, SECRET)).toEqual(key);
  });

  it("A12 rejects malformed payloads and wrong shapes", () => {
    for (const m of ["", "no-dot", ".", "a.", ".b", "!!!.@@@", Buffer.from("not json").toString("base64url") + ".x"])
      expect(() => verifyCursor(m, base, SECRET)).toThrow(InvalidCursor);
    const mk = (obj: unknown) => {
      const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
      return `${p}.${createHmac("sha256", SECRET).update(p).digest("base64url")}`;
    };
    expect(() => verifyCursor(mk({ v: 2, b: bindingHash(base), k: key }), base, SECRET)).toThrow(InvalidCursor);
    expect(() => verifyCursor(mk({ v: 1, b: bindingHash(base), k: ["only-one"] }), base, SECRET)).toThrow(InvalidCursor);
    expect(() => verifyCursor(mk({ v: 1, b: bindingHash(base), k: [1, 2] }), base, SECRET)).toThrow(InvalidCursor);
    expect(() => verifyCursor(mk({ v: 1, k: key }), base, SECRET)).toThrow(InvalidCursor);
  });
});

describe("cursor keyset pagination (B)", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await startTestDatabase();
    const { db, admin } = database;
    const mkPrincipal = async (subject: string, email: string) =>
      (await admin.query<{ id: string }>(
        `insert into aura.principals (issuer, subject, email, email_verified_at)
         values ('local', $1, $2, now()) returning id`,
        [subject, email]
      ))[0]!.id;
    const owner = await mkPrincipal("cursor-owner", "cursor-owner@x.test");
    const reviewer = await mkPrincipal("cursor-admin", "cursor-admin@x.test");
    const org = (await db.transaction(async tx => {
      await tx.bindPrincipal(owner);
      return tx.query<{ id: string }>(`select (aura.create_organization('Cursor Org', 'cursor-org')).id as id`);
    }))[0]!.id;
    await admin.query(`insert into aura.platform_admins (principal_id) values ($1)`, [reviewer]);
    const seller = (await db.transaction(async tx => {
      await tx.bindPrincipal(owner);
      return tx.query<{ id: string }>(
        `insert into aura.seller_profiles (org_id, display_name, legal_name, business_email, country, created_by)
         values ($1, 'S', 'S Legal', 's@x.test', 'IN', $2) returning id`,
        [org, owner]
      );
    }))[0]!.id;
    await db.transaction(async tx => {
      await tx.bindPrincipal(owner);
      await tx.query(`update aura.seller_profiles set status = 'submitted' where id = $1`, [seller]);
    });
    await db.transaction(async tx => {
      await tx.bindPrincipal(reviewer);
      await tx.query(`update aura.seller_profiles set status = 'approved' where id = $1`, [seller]);
    });
    const sneakers = (await admin.query<{ id: string }>(`select id from aura.categories where slug = 'sneakers'`))[0]!.id;
    const upperMaterial = (await admin.query<{ id: string }>(
      `select id from aura.category_attributes where category_id = $1 and key = 'upper-material'`, [sneakers]
    ))[0]!.id;

    for (let i = 0; i < 7; i++) {
      const pid = (await db.transaction(async tx => {
        await tx.bindPrincipal(owner);
        return tx.query<{ id: string }>(
          `insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [org, seller, sneakers, `prod-${i}`, `Product ${i}`, owner]
        );
      }))[0]!.id;
      await db.transaction(async tx => {
        await tx.bindPrincipal(owner);
        await tx.query(
          `insert into aura.product_variants (org_id, product_id, sku, title, size, colour, created_by)
           values ($1, $2, $3, 'Standard', '42', 'black', $4)`,
          [org, pid, `SKU-${i}`, owner]
        );
        await tx.query(
          `insert into aura.product_media (org_id, product_id, kind, url, alt_text, created_by)
           values ($1, $2, 'image', 'https://images.example.test/p.jpg', 'Photo', $3)`,
          [org, pid, owner]
        );
        await tx.query(
          `insert into aura.product_attribute_values (org_id, product_id, attribute_id, value)
           values ($1, $2, $3, 'knit')`,
          [org, pid, upperMaterial]
        );
      });
      const rev = (await db.transaction(async tx => {
        await tx.bindPrincipal(owner);
        const r = await tx.query<{ id: string }>(
          `insert into aura.product_revisions (product_id, org_id, submitted_by) values ($1, $2, $3) returning id`,
          [pid, org, owner]
        );
        await tx.query(`update aura.products set status = 'submitted' where id = $1`, [pid]);
        return r;
      }))[0]!.id;
      await db.transaction(async tx => {
        await tx.bindPrincipal(reviewer);
        await tx.query(`update aura.product_revisions set decision = 'approved' where id = $1`, [rev]);
        await tx.query(`update aura.products set status = 'approved', approved_revision_id = $2 where id = $1`, [pid, rev]);
      });
    }
    // Stagger approved_at by days for a meaningful, full-precision keyset.
    await admin.query(`alter table aura.products disable trigger products_guard`);
    await admin.query(`alter table aura.products disable trigger products_touch`);
    for (let i = 0; i < 7; i++)
      await admin.query(
        `update aura.products set approved_at = now() - ($1 || ' days')::interval where slug = $2`,
        [String(7 - i), `prod-${i}`]
      );
    await admin.query(`alter table aura.products enable trigger products_guard`);
    await admin.query(`alter table aura.products enable trigger products_touch`);
  }, 60_000);

  afterAll(async () => {
    await database?.close();
  });

  /** Page through the public projection with the implementation cursor. */
  async function paginate(binding: CursorBinding, search: boolean): Promise<string[]> {
    const collected: string[] = [];
    let ck: CursorKey | null = null;
    for (let page = 0; page < 50; page++) {
      const order = binding.sort === "newest" ? "p.approved_at desc, p.slug desc" : "p.title asc, p.slug asc";
      const keyCol = binding.sort === "newest" ? "p.approved_at::text" : "p.title";
      // Search binds $1 to the term and shifts the keyset to $2/$3; without a
      // term the keyset uses $1/$2 so no parameter is left untyped.
      const k = search ? 2 : 1;
      const cmp = binding.sort === "newest"
        ? `($${k}::timestamptz is null or (p.approved_at, p.slug) < ($${k}, $${k + 1}))`
        : `($${k}::text is null or (p.title, p.slug) > ($${k}, $${k + 1}))`;
      const searchClause = search
        ? "to_tsvector('simple', p.title || ' ' || coalesce(p.summary, '')) @@ websearch_to_tsquery('simple', $1) and"
        : "";
      const limitParam = search ? "$4" : "$3";
      const params = search
        ? [binding.q, ck ? ck[0] : null, ck ? ck[1] : null, binding.limit]
        : [ck ? ck[0] : null, ck ? ck[1] : null, binding.limit];
      const rows = await database.publicDb.query<{ slug: string; k0: string }>(
        `select p.slug, ${keyCol} as k0 from aura.public_products p
          where ${searchClause} ${cmp}
          order by ${order} limit ${limitParam}`,
        params
      );
      if (!rows.length) break;
      collected.push(...rows.map(r => r.slug));
      const last = rows[rows.length - 1]!;
      ck = verifyCursor(signCursor(binding, [last.k0, last.slug], SECRET), binding, SECRET);
      if (rows.length < binding.limit) break;
    }
    return collected;
  }

  it("B1 newest-sort pagination has no duplicates or omissions", async () => {
    const binding: CursorBinding = { ...base, sort: "newest", limit: 3 };
    const expected = (await database.publicDb.query<{ slug: string }>(
      `select slug from aura.public_products order by approved_at desc, slug desc`
    )).map(r => r.slug);
    const collected = await paginate(binding, false);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(collected.length);
    expect(collected).toHaveLength(7);
  });

  it("B2 title-sort pagination has no duplicates or omissions", async () => {
    const binding: CursorBinding = { ...base, sort: "title", limit: 2 };
    const expected = (await database.publicDb.query<{ slug: string }>(
      `select slug from aura.public_products order by title asc, slug asc`
    )).map(r => r.slug);
    const collected = await paginate(binding, false);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(collected.length);
    expect(collected).toHaveLength(7);
  });

  it("B3 search-bound pagination covers every match and binds the term", async () => {
    const binding: CursorBinding = { ...base, q: "product", sort: "newest", limit: 3 };
    const collected = await paginate(binding, true);
    expect(collected).toHaveLength(7);
    expect(new Set(collected).size).toBe(7);
    const token = signCursor(binding, ["2026-11-20 00:00:00+00", "prod-6"], SECRET);
    expect(() => verifyCursor(token, { ...binding, q: "other" }, SECRET)).toThrow(InvalidCursor);
  });

  it("B4 a newest cursor cannot be reused under title sort", () => {
    const token = signCursor({ ...base, sort: "newest" }, ["2026-11-20 00:00:00+00", "prod-6"], SECRET);
    expect(() => verifyCursor(token, { ...base, sort: "title" }, SECRET)).toThrow(InvalidCursor);
  });
});
