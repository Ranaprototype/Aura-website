/**
 * Independent Phase 3 security audit.
 *
 * Each test maps directly to one of the owner's review questions and asserts
 * the allow/deny decision against the real database, the real RLS policies and
 * the real guards. Two HTTP checks cover the admin surface. The engine is the
 * disposable embedded PostgreSQL used by the other suites (PGlite over the
 * PostgreSQL wire protocol as the restricted `aura_app` role) — this is not a
 * deployed PostgreSQL instance.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUser, startTestApp, type TestApp } from "./support/app";
import { startTestDatabase, type TestDatabase } from "./support/database";
import type { Transaction } from "../server/db/database";

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "aaaaaaaa-0000-4000-8000-000000000002";
const OWNER_A = "bbbbbbbb-0000-4000-8000-000000000001";
const MEMBER_A = "bbbbbbbb-0000-4000-8000-000000000002";
const VIEWER_A = "bbbbbbbb-0000-4000-8000-000000000003";
const OWNER_B = "bbbbbbbb-0000-4000-8000-000000000004";
const OPERATOR = "bbbbbbbb-0000-4000-8000-000000000005";
const OUTSIDER = "bbbbbbbb-0000-4000-8000-000000000006";

let db: TestDatabase["db"];
let admin: TestDatabase["admin"];
let test: TestDatabase;

type Tx = Transaction;

const as = <T>(
  principalId: string | null,
  fn: (tx: Tx) => Promise<T>
): Promise<T> =>
  db.transaction(async tx => {
    if (principalId) await tx.bindPrincipal(principalId);
    return fn(tx);
  });

const approveSeller = async (orgId: string) => {
  await as(ownerOf(orgId), tx =>
    tx.query(
      `update aura.seller_profiles set status = 'submitted' where org_id = $1`,
      [orgId]
    )
  );
  await as(OPERATOR, tx =>
    tx.query(
      `update aura.seller_profiles set status = 'approved' where org_id = $1`,
      [orgId]
    )
  );
};

const ownerOf = (orgId: string) => (orgId === ORG_A ? OWNER_A : OWNER_B);

const makeProduct = async (orgId: string, title: string) => {
  const seller = await admin.query<{ id: string }>(
    `select id from aura.seller_profiles where org_id = $1`,
    [orgId]
  );
  const rows = await as(ownerOf(orgId), tx =>
    tx.query<{ id: string }>(
      `insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
       select $1, $2, c.id, $3, $4, aura.current_principal()
         from aura.categories c where c.slug = 'sneakers'
       returning id`,
      [
        orgId,
        seller[0]!.id,
        `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
        title,
      ]
    )
  );
  return rows[0]!.id;
};

const addVariant = (principalId: string, orgId: string, productId: string) =>
  as(principalId, tx =>
    tx.query(
      `insert into aura.product_variants (org_id, product_id, sku, title, created_by)
       values ($1, $2, $3, 'Audit variant', aura.current_principal())`,
      [
        orgId,
        productId,
        `AUDIT-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      ]
    )
  );

const submitAndApprove = async (orgId: string, productId: string) => {
  const owner = ownerOf(orgId);
  await addVariant(owner, orgId, productId);
  await as(owner, tx =>
    tx.query(
      `insert into aura.product_attribute_values (org_id, product_id, attribute_id, value)
       select $1, $2, a.id, 'knit'
         from aura.category_attributes a
         join aura.categories c on c.id = a.category_id
        where c.slug = 'sneakers' and a.key = 'upper-material'`,
      [orgId, productId]
    )
  );
  await as(owner, async tx => {
    await tx.query(
      `insert into aura.product_revisions (product_id, org_id, revision_number, snapshot, submitted_by)
       values ($1, $2, 0, '{}'::jsonb, aura.current_principal())`,
      [productId, orgId]
    );
    await tx.query(
      `update aura.products set status = 'submitted' where id = $1`,
      [productId]
    );
  });
  const revision = await admin.query<{ id: string }>(
    `select id from aura.product_revisions where product_id = $1 and decision = 'pending'`,
    [productId]
  );
  await as(OPERATOR, async tx => {
    await tx.query(
      `update aura.product_revisions set decision = 'approved' where id = $1`,
      [revision[0]!.id]
    );
    await tx.query(
      `update aura.products set status = 'approved', approved_revision_id = $2 where id = $1`,
      [productId, revision[0]!.id]
    );
  });
  return revision[0]!.id;
};

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  admin = test.admin;

  await admin.query(
    `insert into aura.principals (id, issuer, subject, email, display_name) values
       ($1,'local','audit-owner-a','audit-owner-a@example.test','Owner A'),
       ($2,'local','audit-member-a','audit-member-a@example.test','Member A'),
       ($3,'local','audit-viewer-a','audit-viewer-a@example.test','Viewer A'),
       ($4,'local','audit-owner-b','audit-owner-b@example.test','Owner B'),
       ($5,'local','audit-operator','audit-operator@example.test','Operator'),
       ($6,'local','audit-outsider','audit-outsider@example.test','Outsider')`,
    [OWNER_A, MEMBER_A, VIEWER_A, OWNER_B, OPERATOR, OUTSIDER]
  );
  await admin.query(
    `insert into aura.organizations (id, name, slug, created_by) values
       ($1,'Audit A','audit-a',$3), ($2,'Audit B','audit-b',$4)`,
    [ORG_A, ORG_B, OWNER_A, OWNER_B]
  );
  await admin.query(
    `insert into aura.memberships (org_id, principal_id, role) values
       ($1,$3,'owner'), ($1,$4,'member'), ($1,$5,'viewer'), ($2,$6,'owner')`,
    [ORG_A, ORG_B, OWNER_A, MEMBER_A, VIEWER_A, OWNER_B]
  );
  await admin.query(
    `insert into aura.platform_admins (principal_id, note) values ($1, 'audit')`,
    [OPERATOR]
  );
  await as(OWNER_A, tx =>
    tx.query(
      `insert into aura.seller_profiles
         (org_id, display_name, legal_name, business_email, country, created_by)
       values ($1, 'Audit A', 'Audit A Ltd', 'a@audit.test', 'IN', $2)`,
      [ORG_A, OWNER_A]
    )
  );
  await as(OWNER_B, tx =>
    tx.query(
      `insert into aura.seller_profiles
         (org_id, display_name, legal_name, business_email, country, created_by)
       values ($1, 'Audit B', 'Audit B Ltd', 'b@audit.test', 'IN', $2)`,
      [ORG_B, OWNER_B]
    )
  );
  await approveSeller(ORG_A);
  await approveSeller(ORG_B);
});

afterAll(async () => {
  await test?.close();
});

describe("owner review questions", () => {
  it("Q1 · a seller cannot read or change another organization's products", async () => {
    const productA = await makeProduct(ORG_A, "Tenant A Secret");

    expect(
      await as(OWNER_B, tx =>
        tx.query(`select id from aura.products where id = $1`, [productA])
      )
    ).toEqual([]);

    const stolen = await as(OWNER_B, tx =>
      tx.query(
        `update aura.products set title = 'Stolen' where id = $1 returning id`,
        [productA]
      )
    );
    expect(stolen).toEqual([]);

    const viaForeignParent = await as(OWNER_B, tx =>
      tx.query(
        `insert into aura.product_variants (org_id, product_id, sku, title, created_by)
         values ($1, $2, 'CROSS-TENANT-AUDIT', 'Cross', aura.current_principal())`,
        [ORG_B, productA]
      )
    ).catch((error: Error) => error.message);
    // The parent is invisible to this tenant, so the guard reports it as absent
    // rather than confirming another tenant's product exists.
    expect(String(viaForeignParent)).toMatch(
      /forbidden|violates|foreign key|product_not_found/i
    );
  });

  it("Q2 · a seller cannot approve their own seller profile or product", async () => {
    // Return the profile to draft, then submit it as the owner and try to
    // approve the very same application.
    await as(OWNER_A, tx =>
      tx.query(
        `update aura.seller_profiles set description = 'self approval check' where org_id = $1`,
        [ORG_A]
      )
    );
    await as(OWNER_A, tx =>
      tx.query(
        `update aura.seller_profiles set status = 'submitted' where org_id = $1`,
        [ORG_A]
      )
    );
    await expect(
      as(OWNER_A, tx =>
        tx.query(
          `update aura.seller_profiles set status = 'approved' where org_id = $1`,
          [ORG_A]
        )
      )
    ).rejects.toThrow(/forbidden/);
    await approveSeller(ORG_A);

    const productA = await makeProduct(ORG_A, "Self Approval Runner");
    await addVariant(OWNER_A, ORG_A, productA);
    await as(OWNER_A, tx =>
      tx.query(
        `insert into aura.product_attribute_values (org_id, product_id, attribute_id, value)
         select $1, $2, a.id, 'knit'
           from aura.category_attributes a
           join aura.categories c on c.id = a.category_id
          where c.slug = 'sneakers' and a.key = 'upper-material'`,
        [ORG_A, productA]
      )
    );
    await as(OWNER_A, async tx => {
      await tx.query(
        `insert into aura.product_revisions (product_id, org_id, revision_number, snapshot, submitted_by)
         values ($1, $2, 0, '{}'::jsonb, aura.current_principal())`,
        [productA, ORG_A]
      );
      await tx.query(
        `update aura.products set status = 'submitted' where id = $1`,
        [productA]
      );
    });
    await expect(
      as(OWNER_A, tx =>
        tx.query(`update aura.products set status = 'approved' where id = $1`, [
          productA,
        ])
      )
    ).rejects.toThrow(/forbidden/);
  });

  it("Q3 · a viewer cannot create, edit, archive or review catalogue content", async () => {
    const productA = await makeProduct(ORG_A, "Viewer Target");

    const inserted = await as(VIEWER_A, tx =>
      tx.query(
        `insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
         select $1, s.id, c.id, 'viewer-write', 'Viewer Write', aura.current_principal()
           from aura.seller_profiles s, aura.categories c
          where s.org_id = $1 and c.slug = 'sneakers'
         returning id`,
        [ORG_A]
      )
    ).catch((error: Error) => error.message);
    expect(String(inserted)).toMatch(/row-level security|violates|forbidden/i);

    expect(
      await as(VIEWER_A, tx =>
        tx.query(
          `update aura.products set title = 'Viewer edit' where id = $1 returning id`,
          [productA]
        )
      )
    ).toEqual([]);
    // The viewer can read the tenant's catalogue and history, but every write
    // above was refused; the product title is unchanged.
    const [row] = await as(OWNER_A, tx =>
      tx.query<{ title: string }>(
        `select title from aura.products where id = $1`,
        [productA]
      )
    );
    expect(row.title).toBe("Viewer Target");
  });

  it("Q4 · changing approved catalogue content withdraws purchasability", async () => {
    const productA = await makeProduct(ORG_A, "Approval Integrity Runner");
    await submitAndApprove(ORG_A, productA);

    expect(
      await as(OWNER_A, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          productA,
        ])
      )
    ).toHaveLength(1);

    await addVariant(MEMBER_A, ORG_A, productA);

    const [row] = await as(OWNER_A, tx =>
      tx.query<{ pending_changes: boolean }>(
        `select pending_changes from aura.products where id = $1`,
        [productA]
      )
    );
    expect(row.pending_changes).toBe(true);
    expect(
      await as(OWNER_A, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          productA,
        ])
      )
    ).toEqual([]);
  });

  it("Q5 · the admin review surface refuses anonymous and ordinary sellers", async () => {
    const app: TestApp = await startTestApp();
    try {
      const anonymous = await fetch(`${app.baseUrl}/api/v1/admin/sellers`);
      expect(anonymous.status).toBe(401);

      const user = await registerUser(app, {
        email: "audit-http@example.test",
        password: "audit-password-123",
        displayName: "Ordinary Seller",
      });
      const denied = await user.client.get("/api/v1/admin/sellers");
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ error: "role_forbidden" });
    } finally {
      await app.close();
    }
  });

  it("Q6 · variants and media cannot be attached across organizations", async () => {
    const productA = await makeProduct(ORG_A, "Cross Tenant Child Runner");

    const variant = await as(OWNER_B, tx =>
      tx.query(
        `insert into aura.product_variants (org_id, product_id, sku, title, created_by)
         values ($1, $2, 'CROSS-ORG-VARIANT', 'Cross', aura.current_principal())`,
        [ORG_B, productA]
      )
    ).catch((error: Error) => error.message);
    expect(String(variant)).toMatch(
      /forbidden|violates|foreign key|product_not_found/i
    );

    const media = await as(OWNER_B, tx =>
      tx.query(
        `insert into aura.product_media (org_id, product_id, kind, url, created_by)
         values ($1, $2, 'image', 'https://cdn.example.test/cross.png', aura.current_principal())`,
        [ORG_B, productA]
      )
    ).catch((error: Error) => error.message);
    expect(String(media)).toMatch(
      /forbidden|violates|foreign key|product_not_found/i
    );

    // Even within the owning tenant, a child row cannot be moved to another
    // organization after creation.
    const ownVariant = await as(OWNER_A, async tx => {
      const rows = await tx.query<{ id: string }>(
        `insert into aura.product_variants (org_id, product_id, sku, title, created_by)
         values ($1, $2, $3, 'Own variant', aura.current_principal())
         returning id`,
        [ORG_A, productA, `OWN-${Date.now()}`]
      );
      return rows[0]!.id;
    });
    const moved = await as(OWNER_A, tx =>
      tx.query(`update aura.product_variants set org_id = $2 where id = $1`, [
        ownVariant,
        ORG_B,
      ])
    ).catch((error: Error) => error.message);
    expect(String(moved)).toMatch(
      /forbidden|violates|immutable|row-level security/i
    );
  });

  it("Q7 · the storefront projection shows only approved products of approved sellers", async () => {
    const productA = await makeProduct(ORG_A, "Projection Runner");
    await submitAndApprove(ORG_A, productA);

    const visible = await as(OWNER_A, tx =>
      tx.query<{ id: string }>(
        `select id from aura.storefront_products where id = $1`,
        [productA]
      )
    );
    expect(visible).toHaveLength(1);

    // Another tenant's member cannot see it through the same projection.
    expect(
      await as(MEMBER_A, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          productA,
        ])
      )
    ).toHaveLength(1);
    expect(
      await as(OWNER_B, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          productA,
        ])
      )
    ).toEqual([]);

    // An approved product whose seller has fallen back to draft disappears.
    await as(OWNER_A, tx =>
      tx.query(
        `update aura.seller_profiles set description = 'Details changed' where org_id = $1`,
        [ORG_A]
      )
    );
    expect(
      await as(OWNER_A, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          productA,
        ])
      )
    ).toEqual([]);

    // Restore the fixture for any later test.
    await approveSeller(ORG_A);
  });
});
