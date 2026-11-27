/**
 * Phase 3 database verification.
 *
 * Every statement runs through the real `pg` driver against a disposable
 * PostgreSQL instance as the restricted runtime role: non-owner, no BYPASSRLS.
 * Identity is bound transaction-locally exactly as the API binds it, so the
 * policies, composite tenant foreign keys, lifecycle triggers and the
 * append-only audit trail are exercised rather than described.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./support/database";
import { PgDatabase, type Transaction } from "../server/db/database";

let test: TestDatabase;
let db: PgDatabase;
let admin: PgDatabase;

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VIEWER_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OPERATOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTSIDER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

type Tx = Transaction;

/** Runs a callback with a verified principal (and optionally an organization). */
const as = async <T>(
  principalId: string | null,
  fn: (tx: Tx) => Promise<T>,
  orgId?: string
) =>
  db.transaction(async tx => {
    if (principalId) await tx.bindPrincipal(principalId);
    if (orgId) await tx.bindOrganization(orgId, "owner");
    return fn(tx);
  });

/** Moves an organization's seller profile to `approved` through the real flow. */
const ensureApprovedSeller = async (
  orgId: string,
  ownerId: string,
  name = "Aura Atelier"
) => {
  const existing = await admin.query<{ id: string; status: string }>(
    `select id, status from aura.seller_profiles where org_id = $1`,
    [orgId]
  );
  if (!existing[0]) {
    await as(ownerId, tx =>
      tx.query(
        `insert into aura.seller_profiles
           (org_id, display_name, legal_name, business_email, country, website, created_by)
         values ($1, $2, $2, 'studio@example.test', 'IN', 'https://example.test',
                 aura.current_principal())`,
        [orgId, name]
      )
    );
  }
  if (existing[0]?.status !== "approved") {
    await as(ownerId, tx =>
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
  }
  const rows = await admin.query<{ id: string }>(
    `select id from aura.seller_profiles where org_id = $1`,
    [orgId]
  );
  return rows[0]!.id;
};

const createProduct = async (
  tx: Tx,
  orgId: string,
  sellerProfileId: string,
  title: string
) => {
  const rows = await tx.query<{
    id: string;
    status: string;
    pending_changes: boolean;
    approved_revision_id: string | null;
  }>(
    `insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
     select $1, $2, c.id, $3, $4, aura.current_principal()
       from aura.categories c where c.slug = 'sneakers'
     returning id, status, pending_changes, approved_revision_id`,
    [
      orgId,
      sellerProfileId,
      `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      title,
    ]
  );
  return rows[0]!;
};

const addVariant = (tx: Tx, orgId: string, productId: string, sku: string) =>
  tx.query<{ id: string }>(
    `insert into aura.product_variants (org_id, product_id, sku, title, size, colour, created_by)
     values ($1, $2, $3, 'Default', '42', 'cyan', aura.current_principal())
     returning id`,
    [orgId, productId, sku]
  );

const setAttribute = async (
  tx: Tx,
  orgId: string,
  productId: string,
  categorySlug: string,
  key: string,
  value: string
) => {
  const rows = await tx.query<{ id: string }>(
    `insert into aura.product_attribute_values (org_id, product_id, attribute_id, value)
     select $1, $2, a.id, $5
       from aura.category_attributes a
       join aura.categories c on c.id = a.category_id
      where c.slug = $3 and a.key = $4
     returning id`,
    [orgId, productId, categorySlug, key, value]
  );
  return rows[0]!;
};

const submit = (tx: Tx, orgId: string, productId: string) =>
  tx.query<{ id: string; revision_number: number; snapshot: unknown }>(
    `insert into aura.product_revisions (product_id, org_id, revision_number, snapshot, submitted_by)
     values ($1, $2, 0, '{}'::jsonb, aura.current_principal())
     returning id, revision_number, snapshot`,
    [productId, orgId]
  );

const setStatus = (tx: Tx, productId: string, status: string) =>
  tx.query<{ status: string; pending_changes: boolean }>(
    `update aura.products set status = $2 where id = $1
     returning status, pending_changes`,
    [productId, status]
  );

const preparableProduct = async (title: string) =>
  as(OWNER_A, async tx => {
    const seller = await tx.query<{ id: string }>(
      `select id from aura.seller_profiles where org_id = $1`,
      [ORG_A]
    );
    const product = await createProduct(tx, ORG_A, seller[0]!.id, title);
    await addVariant(
      tx,
      ORG_A,
      product.id,
      `SKU-${Date.now()}-${title.slice(0, 4)}`
    );
    await setAttribute(
      tx,
      ORG_A,
      product.id,
      "sneakers",
      "upper-material",
      "knit"
    );
    return product;
  });

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  admin = test.admin;

  await admin.query(
    `insert into aura.principals (id, issuer, subject, email, display_name) values
       ($1,'local','owner-a','owner-a@example.test','Owner A'),
       ($2,'local','owner-b','owner-b@example.test','Owner B'),
       ($3,'local','member-a','member-a@example.test','Member A'),
       ($4,'local','viewer-a','viewer-a@example.test','Viewer A'),
       ($5,'local','operator','operator@example.test','Operator'),
       ($6,'local','outsider','outsider@example.test','Outsider')`,
    [OWNER_A, OWNER_B, MEMBER_A, VIEWER_A, OPERATOR, OUTSIDER]
  );
  await admin.query(
    `insert into aura.organizations (id, name, slug, created_by) values
       ($1,'Tenant A','tenant-a',$3), ($2,'Tenant B','tenant-b',$4)`,
    [ORG_A, ORG_B, OWNER_A, OWNER_B]
  );
  await admin.query(
    `insert into aura.memberships (org_id, principal_id, role) values
       ($1,$3,'owner'), ($1,$4,'member'), ($1,$5,'viewer'), ($2,$6,'owner')`,
    [ORG_A, ORG_B, OWNER_A, MEMBER_A, VIEWER_A, OWNER_B]
  );
  await admin.query(
    `insert into aura.platform_admins (principal_id, note) values ($1, 'verification fixture')`,
    [OPERATOR]
  );
});

afterAll(async () => {
  await test.close();
});

describe("seller onboarding", () => {
  it("creates a draft profile, records the audit trail and submits for review", async () => {
    const created = await as(OWNER_A, tx =>
      tx.query<{ id: string; status: string }>(
        `insert into aura.seller_profiles
           (org_id, display_name, legal_name, business_email, country, website, created_by)
         values ($1, 'Aura Atelier', 'Aura Atelier Private Limited', 'studio@example.test',
                 'IN', 'https://example.test', aura.current_principal())
         returning id, status`,
        [ORG_A]
      )
    );
    expect(created[0]).toMatchObject({ status: "draft" });

    const audit = await as(OWNER_A, tx =>
      tx.query<{ action: string }>(
        `select action from aura.audit_events where entity_type = 'seller_profile'`
      )
    );
    expect(audit.map(row => row.action)).toContain("seller.created");

    const submitted = await as(OWNER_A, tx =>
      tx.query<{ status: string }>(
        `update aura.seller_profiles set status = 'submitted' where org_id = $1 returning status`,
        [ORG_A]
      )
    );
    expect(submitted[0]?.status).toBe("submitted");
  });

  it("refuses to let a seller review their own application", async () => {
    await expect(
      as(OWNER_A, tx =>
        tx.query(
          `update aura.seller_profiles set status = 'approved' where org_id = $1`,
          [ORG_A]
        )
      )
    ).rejects.toThrow(/forbidden/);
  });

  it("requires a review note to reject and records the reviewer", async () => {
    await expect(
      as(OPERATOR, tx =>
        tx.query(
          `update aura.seller_profiles set status = 'rejected' where org_id = $1`,
          [ORG_A]
        )
      )
    ).rejects.toThrow(/review_note_required/);

    const reviewed = await as(OPERATOR, tx =>
      tx.query<{
        status: string;
        reviewed_by: string;
        reviewed_at: Date | null;
      }>(
        `update aura.seller_profiles set status = 'approved' where org_id = $1
         returning status, reviewed_by, reviewed_at`,
        [ORG_A]
      )
    );
    expect(reviewed[0]?.status).toBe("approved");
    expect(reviewed[0]?.reviewed_by).toBe(OPERATOR);
    expect(reviewed[0]?.reviewed_at).toBeInstanceOf(Date);
  });

  it("returns an approved seller to draft when business information changes", async () => {
    const edited = await as(OWNER_A, tx =>
      tx.query<{ status: string; reviewed_by: string | null }>(
        `update aura.seller_profiles set legal_name = 'Aura Atelier Ltd' where org_id = $1
         returning status, reviewed_by`,
        [ORG_A]
      )
    );
    expect(edited[0]).toEqual({ status: "draft", reviewed_by: null });
  });

  it("denies onboarding writes to viewers and non-members", async () => {
    for (const principal of [VIEWER_A, OUTSIDER]) {
      await expect(
        as(principal, tx =>
          tx.query(
            `insert into aura.seller_profiles
               (org_id, display_name, legal_name, business_email, country, created_by)
             values ($1, 'No', 'No Ltd', 'no@example.test', 'IN', aura.current_principal())`,
            [ORG_A]
          )
        )
      ).rejects.toThrow(/forbidden|row-level security|denied/i);
    }
  });
});

describe("tenant isolation", () => {
  let sellerA: string;
  let sellerB: string;
  let productA: string;

  beforeAll(async () => {
    sellerA = await ensureApprovedSeller(ORG_A, OWNER_A);
    sellerB = await ensureApprovedSeller(ORG_B, OWNER_B, "Tenant B Studio");
    productA = (
      await as(OWNER_A, tx =>
        createProduct(tx, ORG_A, sellerA, "Tenant A Product")
      )
    ).id;
  });

  it("hides another tenant's seller profile, products and audit history", async () => {
    const seen = await as(OWNER_B, tx =>
      tx.query<{ id: string }>(
        `select id from aura.seller_profiles where org_id = $1
         union all select id from aura.products where org_id = $1
         union all select id from aura.audit_events where org_id = $1`,
        [ORG_A]
      )
    );
    expect(seen).toEqual([]);
  });

  it("cannot attach a product to another tenant's seller profile", async () => {
    await expect(
      as(OWNER_B, tx =>
        tx.query(
          `insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
           select $1, $2, c.id, 'cross-tenant', 'Cross Tenant', aura.current_principal()
             from aura.categories c where c.slug = 'sneakers'`,
          [ORG_B, sellerA]
        )
      )
    ).rejects.toThrow(/seller_not_approved|foreign key|violates/i);

    // The tenant scoping is also structural: each child row references its
    // parent through a composite (org_id, id) foreign key, so a mismatch cannot
    // be represented even by a caller that bypasses the lifecycle guard.
    const constraints = await admin.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where conname in ('product_variants_product_fk', 'product_media_product_fk',
                          'product_attribute_values_product_fk',
                          'product_revisions_product_fk', 'products_seller_fk',
                          'products_approved_revision_fk')
        order by conname`
    );
    expect(constraints.map(row => row.conname)).toEqual([
      "product_attribute_values_product_fk",
      "product_media_product_fk",
      "product_revisions_product_fk",
      "product_variants_product_fk",
      "products_approved_revision_fk",
      "products_seller_fk",
    ]);
    for (const row of constraints)
      expect(row.def, row.conname).toMatch(
        /\(org_id, (id|product_id|seller_profile_id|approved_revision_id)\)/
      );
  });

  it("cannot read or update another tenant's product through the API role", async () => {
    const updated = await as(OWNER_B, tx =>
      tx.query(
        `update aura.products set title = 'stolen' where id = $1 returning id`,
        [productA]
      )
    );
    expect(updated).toEqual([]);
    const visible = await as(OWNER_B, tx =>
      tx.query(`select id from aura.products where id = $1`, [productA])
    );
    expect(visible).toEqual([]);
  });

  it("cannot create a variant in a different organization from its product", async () => {
    await expect(
      as(OWNER_A, tx => addVariant(tx, ORG_B, productA, "MISMATCH-1"))
    ).rejects.toThrow(
      /foreign key|violates|row-level security|denied|forbidden/i
    );
  });

  it("returns no seller or product rows when no identity is bound", async () => {
    const rows = await as(null, tx =>
      tx.query<{ source: string }>(
        `select 'seller' as source from aura.seller_profiles
         union all select 'product' from aura.products
         union all select 'audit' from aura.audit_events`
      )
    );
    expect(rows).toEqual([]);
    // Reference data is global and readable; tenant data is not.
    const categories = await as(null, tx =>
      tx.query(`select id from aura.categories`)
    );
    expect(categories.length).toBe(3);
  });

  it("keeps a second tenant's product list independent", async () => {
    const productB = await as(OWNER_B, tx =>
      tx.query<{ id: string }>(
        `insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
         select $1, $2, c.id, 'tenant-b-product', 'Tenant B Product', aura.current_principal()
           from aura.categories c where c.slug = 'apparel'
         returning id`,
        [ORG_B, sellerB]
      )
    );
    expect(productB).toHaveLength(1);
    const listA = await as(OWNER_A, tx =>
      tx.query<{ slug: string }>(`select slug from aura.products order by slug`)
    );
    expect(listA).toHaveLength(1);
    expect(listA[0]!.slug.startsWith("tenant-a-product")).toBe(true);
  });
});

describe("product lifecycle", () => {
  let productId: string;

  beforeAll(async () => {
    await ensureApprovedSeller(ORG_A, OWNER_A);
    productId = (await preparableProduct("Lifecycle Runner")).id;
  });

  it("creates a draft that is not purchasable", async () => {
    const rows = await as(OWNER_A, tx =>
      tx.query<{ status: string; pending_changes: boolean }>(
        `select status, pending_changes from aura.products where id = $1`,
        [productId]
      )
    );
    expect(rows[0]).toEqual({ status: "draft", pending_changes: false });
    const view = await as(OWNER_A, tx =>
      tx.query(`select id from aura.storefront_products where id = $1`, [
        productId,
      ])
    );
    expect(view).toEqual([]);
  });

  it("refuses to submit a product that is missing a required attribute", async () => {
    const missing = await as(OWNER_A, async tx => {
      const seller = await tx.query<{ id: string }>(
        `select id from aura.seller_profiles where org_id = $1`,
        [ORG_A]
      );
      const product = await createProduct(
        tx,
        ORG_A,
        seller[0]!.id,
        "Incomplete Runner"
      );
      await addVariant(tx, ORG_A, product.id, `INC-${Date.now()}`);
      return product;
    });
    await expect(
      as(OWNER_A, tx => setStatus(tx, missing.id, "submitted"))
    ).rejects.toThrow(/product_incomplete/);
    // A product with no variant at all is also refused.
    const bare = await as(OWNER_A, async tx => {
      const seller = await tx.query<{ id: string }>(
        `select id from aura.seller_profiles where org_id = $1`,
        [ORG_A]
      );
      return createProduct(tx, ORG_A, seller[0]!.id, "Bare Runner");
    });
    await expect(
      as(OWNER_A, tx => setStatus(tx, bare.id, "submitted"))
    ).rejects.toThrow(/product_incomplete/);
  });

  it("snapshots the submitted content and locks it during review", async () => {
    const revision = await as(OWNER_A, async tx => {
      const rows = await submit(tx, ORG_A, productId);
      await setStatus(tx, productId, "submitted");
      return rows[0]!;
    });
    expect(revision.revision_number).toBe(1);
    expect(JSON.stringify(revision.snapshot)).toContain("SKU-");
    expect(JSON.stringify(revision.snapshot)).toContain("upper-material");

    await expect(
      as(OWNER_A, tx => submit(tx, ORG_A, productId))
    ).rejects.toThrow(/product_locked/);
    await expect(
      as(OWNER_A, tx =>
        tx.query(
          `update aura.products set title = 'Changed Under Review' where id = $1`,
          [productId]
        )
      )
    ).rejects.toThrow(/product_locked/);
  });

  it("refuses to approve without the platform administrator grant", async () => {
    const changed = await as(OWNER_A, tx =>
      tx.query(
        `update aura.product_revisions set decision = 'approved'
          where product_id = $1 and decision = 'pending'`,
        [productId]
      )
    );
    expect(changed).toEqual([]);
  });

  it("approves a submitted revision and only then becomes purchasable", async () => {
    const revisionId = (
      await as(OPERATOR, tx =>
        tx.query<{ id: string }>(
          `select id from aura.product_revisions where product_id = $1 and decision = 'pending'`,
          [productId]
        )
      )
    )[0]!.id;

    await as(OPERATOR, tx =>
      tx.query(
        `update aura.product_revisions set decision = 'approved' where id = $1`,
        [revisionId]
      )
    );
    const approved = await as(OPERATOR, tx =>
      tx.query<{ status: string; approved_revision_id: string }>(
        `update aura.products
            set status = 'approved', approved_revision_id = $2, approved_at = now()
          where id = $1 returning status, approved_revision_id`,
        [productId, revisionId]
      )
    );
    expect(approved[0]).toEqual({
      status: "approved",
      approved_revision_id: revisionId,
    });

    const view = await as(OWNER_A, tx =>
      tx.query(`select id from aura.storefront_products where id = $1`, [
        productId,
      ])
    );
    expect(view).toHaveLength(1);
  });

  it("drops out of the purchasable projection as soon as approved content is edited", async () => {
    const edited = await as(OWNER_A, tx =>
      tx.query<{ status: string; pending_changes: boolean }>(
        `update aura.products set description = 'Revised copy' where id = $1
         returning status, pending_changes`,
        [productId]
      )
    );
    expect(edited[0]).toEqual({ status: "approved", pending_changes: true });
    const view = await as(OWNER_A, tx =>
      tx.query(`select id from aura.storefront_products where id = $1`, [
        productId,
      ])
    );
    expect(view).toEqual([]);
  });

  it("clears approval when variants, media or attributes change on an approved product", async () => {
    const product = await preparableProduct("Late Edit Runner");
    await as(OWNER_A, async tx => {
      await submit(tx, ORG_A, product.id);
      await setStatus(tx, product.id, "submitted");
    });
    const revisionId = (
      await as(OPERATOR, tx =>
        tx.query<{ id: string }>(
          `select id from aura.product_revisions where product_id = $1 and decision = 'pending'`,
          [product.id]
        )
      )
    )[0]!.id;
    await as(OPERATOR, async tx => {
      await tx.query(
        `update aura.product_revisions set decision = 'approved' where id = $1`,
        [revisionId]
      );
      await tx.query(
        `update aura.products set status = 'approved', approved_revision_id = $2 where id = $1`,
        [product.id, revisionId]
      );
    });
    expect(
      await as(OWNER_A, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          product.id,
        ])
      )
    ).toHaveLength(1);

    // A member (catalogue writer) adds a variant after approval. The approval
    // must no longer describe the listing, so purchasability is withdrawn.
    await as(MEMBER_A, tx =>
      addVariant(tx, ORG_A, product.id, `LATE-${Date.now()}`)
    );
    const [pending] = await as(OWNER_A, tx =>
      tx.query<{ status: string; pending_changes: boolean }>(
        `select status, pending_changes from aura.products where id = $1`,
        [product.id]
      )
    );
    expect(pending).toEqual({ status: "approved", pending_changes: true });
    expect(
      await as(OWNER_A, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          product.id,
        ])
      )
    ).toEqual([]);
    const audit = await as(OWNER_A, tx =>
      tx.query<{ action: string }>(
        `select action from aura.audit_events
          where entity_type = 'product' and entity_id = $1 and action = 'product.revised'`,
        [product.id]
      )
    );
    expect(audit.length).toBeGreaterThan(0);
  });

  it("treats media and attribute changes the same way as variants", async () => {
    const product = await preparableProduct("Media Edit Runner");
    await as(OWNER_A, async tx => {
      await submit(tx, ORG_A, product.id);
      await setStatus(tx, product.id, "submitted");
    });
    const revisionId = (
      await as(OPERATOR, tx =>
        tx.query<{ id: string }>(
          `select id from aura.product_revisions where product_id = $1 and decision = 'pending'`,
          [product.id]
        )
      )
    )[0]!.id;
    await as(OPERATOR, async tx => {
      await tx.query(
        `update aura.product_revisions set decision = 'approved' where id = $1`,
        [revisionId]
      );
      await tx.query(
        `update aura.products set status = 'approved', approved_revision_id = $2 where id = $1`,
        [product.id, revisionId]
      );
    });

    await as(OWNER_A, tx =>
      tx.query(
        `insert into aura.product_media (org_id, product_id, kind, url, created_by)
         values ($1, $2, 'image', 'https://cdn.example.test/late.png', aura.current_principal())`,
        [ORG_A, product.id]
      )
    );
    let [row] = await as(OWNER_A, tx =>
      tx.query<{ pending_changes: boolean }>(
        `select pending_changes from aura.products where id = $1`,
        [product.id]
      )
    );
    expect(row.pending_changes).toBe(true);

    // Re-approve the new content, then change an attribute value.
    await as(OWNER_A, async tx => {
      await submit(tx, ORG_A, product.id);
      await setStatus(tx, product.id, "submitted");
    });
    const second = (
      await as(OPERATOR, tx =>
        tx.query<{ id: string }>(
          `select id from aura.product_revisions where product_id = $1 and decision = 'pending'`,
          [product.id]
        )
      )
    )[0]!.id;
    await as(OPERATOR, async tx => {
      await tx.query(
        `update aura.product_revisions set decision = 'approved' where id = $1`,
        [second]
      );
      await tx.query(
        `update aura.products set status = 'approved', approved_revision_id = $2 where id = $1`,
        [product.id, second]
      );
    });
    await as(OWNER_A, tx =>
      tx.query(
        `update aura.product_attribute_values set value = 'leather'
          where product_id = $1
            and attribute_id = (select a.id from aura.category_attributes a
                                 join aura.categories c on c.id = a.category_id
                                where c.slug = 'sneakers' and a.key = 'upper-material')`,
        [product.id]
      )
    );
    [row] = await as(OWNER_A, tx =>
      tx.query<{ pending_changes: boolean }>(
        `select pending_changes from aura.products where id = $1`,
        [product.id]
      )
    );
    expect(row.pending_changes).toBe(true);
  });

  it("locks child catalogue rows while a product is submitted or archived", async () => {
    const product = await preparableProduct("Locked Child Runner");
    await as(OWNER_A, async tx => {
      await submit(tx, ORG_A, product.id);
      await setStatus(tx, product.id, "submitted");
    });
    await expect(
      as(OWNER_A, tx =>
        addVariant(tx, ORG_A, product.id, `LOCKED-${Date.now()}`)
      )
    ).rejects.toThrow(/product_locked/);
    await expect(
      as(OWNER_A, tx =>
        tx.query(
          `delete from aura.product_variants where product_id = $1 and org_id = $2`,
          [product.id, ORG_A]
        )
      )
    ).rejects.toThrow(/product_locked/);

    const archived = await preparableProduct("Archived Child Runner");
    await as(OWNER_A, tx => setStatus(tx, archived.id, "archived"));
    await expect(
      as(OWNER_A, tx =>
        tx.query(
          `insert into aura.product_media (org_id, product_id, kind, url, created_by)
           values ($1, $2, 'image', 'https://cdn.example.test/archived.png', aura.current_principal())`,
          [ORG_A, archived.id]
        )
      )
    ).rejects.toThrow(/product_locked/);
  });

  it("requires an owner or admin, not a member, to edit seller business information", async () => {
    // The policy makes the row invisible to the UPDATE, so no row is changed;
    // the guard rejects the same attempt if the row is ever reached some other
    // way (verified below through the platform grant path, which is audited).
    const updated = await as(MEMBER_A, tx =>
      tx.query(
        `update aura.seller_profiles set description = 'member edit'
          where org_id = $1 returning id`,
        [ORG_A]
      )
    );
    expect(updated).toEqual([]);
    const [profile] = await admin.query<{ description: string | null }>(
      `select description from aura.seller_profiles where org_id = $1`,
      [ORG_A]
    );
    expect(profile.description).not.toBe("member edit");
  });

  it("hides an approved product again when its seller is no longer approved", async () => {
    const product = await preparableProduct("Seller Reset Runner");
    await as(OWNER_A, async tx => {
      await submit(tx, ORG_A, product.id);
      await setStatus(tx, product.id, "submitted");
    });
    const revisionId = (
      await as(OPERATOR, tx =>
        tx.query<{ id: string }>(
          `select id from aura.product_revisions where product_id = $1 and decision = 'pending'`,
          [product.id]
        )
      )
    )[0]!.id;
    await as(OPERATOR, async tx => {
      await tx.query(
        `update aura.product_revisions set decision = 'approved' where id = $1`,
        [revisionId]
      );
      await tx.query(
        `update aura.products set status = 'approved', approved_revision_id = $2 where id = $1`,
        [product.id, revisionId]
      );
    });
    expect(
      await as(OWNER_A, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          product.id,
        ])
      )
    ).toHaveLength(1);

    // Editing approved business information returns the seller to draft, so the
    // projection must stop exposing this seller's catalogue immediately.
    await as(OWNER_A, tx =>
      tx.query(
        `update aura.seller_profiles set description = 'Changed details' where org_id = $1`,
        [ORG_A]
      )
    );
    expect(
      await as(OWNER_A, tx =>
        tx.query(`select id from aura.storefront_products where id = $1`, [
          product.id,
        ])
      )
    ).toEqual([]);

    const seller = await admin.query<{ id: string }>(
      `select id from aura.seller_profiles where org_id = $1`,
      [ORG_A]
    );
    await ensureApprovedSeller(ORG_A, OWNER_A, seller[0]!.id);
  });

  it("rejects a resubmission with a required note and leaves the old approval in place", async () => {
    const revision = await as(OWNER_A, async tx => {
      const rows = await submit(tx, ORG_A, productId);
      await setStatus(tx, productId, "submitted");
      return rows[0]!;
    });
    await expect(
      as(OPERATOR, tx =>
        tx.query(
          `update aura.product_revisions set decision = 'rejected' where id = $1`,
          [revision.id]
        )
      )
    ).rejects.toThrow(/review_note_required/);

    await as(OPERATOR, tx =>
      tx.query(
        `update aura.product_revisions
            set decision = 'rejected', review_note = 'Sizing chart is missing.'
          where id = $1`,
        [revision.id]
      )
    );
    const rejected = await as(OPERATOR, tx =>
      setStatus(tx, productId, "rejected")
    );
    expect(rejected[0]?.status).toBe("rejected");
    const view = await as(OWNER_A, tx =>
      tx.query(`select id from aura.storefront_products where id = $1`, [
        productId,
      ])
    );
    expect(view).toEqual([]);
  });

  it("archives instead of deleting and keeps the audit history", async () => {
    await expect(
      as(OWNER_A, tx =>
        tx.query(`delete from aura.products where id = $1`, [productId])
      )
    ).rejects.toThrow(/permission denied|denied/i);

    const archived = await as(OWNER_A, tx =>
      tx.query<{ status: string; archived_at: Date | null }>(
        `update aura.products set status = 'archived' where id = $1
         returning status, archived_at`,
        [productId]
      )
    );
    expect(archived[0]?.status).toBe("archived");
    expect(archived[0]?.archived_at).toBeInstanceOf(Date);

    const actions = await as(OWNER_A, tx =>
      tx.query<{ action: string }>(
        `select action from aura.audit_events where entity_id = $1 order by created_at`,
        [productId]
      )
    );
    expect(actions.map(row => row.action)).toEqual(
      expect.arrayContaining([
        "product.created",
        "product.submitted",
        "product.approved",
        "product.updated",
        "product.rejected",
        "product.archived",
      ])
    );
  });
});

describe("validation and append-only guarantees", () => {
  let productId: string;

  beforeAll(async () => {
    await ensureApprovedSeller(ORG_A, OWNER_A);
    productId = (await preparableProduct("Validation Runner")).id;
  });

  it("refuses seller-authored review metadata", async () => {
    await expect(
      as(OWNER_A, tx =>
        tx.query(`update aura.products set approved_at = now() where id = $1`, [
          productId,
        ])
      )
    ).rejects.toThrow(/forbidden/);
    await expect(
      as(OWNER_A, tx =>
        tx.query(
          `update aura.products set submitted_at = now() where id = $1`,
          [productId]
        )
      )
    ).rejects.toThrow(/forbidden/);
  });

  it("rejects an attribute from another category", async () => {
    await expect(
      as(OWNER_A, tx =>
        setAttribute(
          tx,
          ORG_A,
          productId,
          "apparel",
          "fabric",
          "organic-cotton"
        )
      )
    ).rejects.toThrow(/attribute_not_in_category/);
  });

  it("rejects a value outside the declared options", async () => {
    await expect(
      as(OWNER_A, tx =>
        setAttribute(
          tx,
          ORG_A,
          productId,
          "sneakers",
          "upper-material",
          "unobtainium"
        )
      )
    ).rejects.toThrow(/invalid_attribute_value/);
  });

  it("enforces tenant-unique SKUs", async () => {
    const second = await as(OWNER_A, async tx => {
      const seller = await tx.query<{ id: string }>(
        `select id from aura.seller_profiles where org_id = $1`,
        [ORG_A]
      );
      return createProduct(tx, ORG_A, seller[0]!.id, "Second Validation");
    });
    const sku = (
      await as(OWNER_A, tx =>
        tx.query<{ sku: string }>(
          `select sku from aura.product_variants where product_id = $1`,
          [productId]
        )
      )
    )[0]!.sku;
    await expect(
      as(OWNER_A, tx => addVariant(tx, ORG_A, second.id, sku))
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("rejects non-https media references and accepts https ones", async () => {
    await expect(
      as(OWNER_A, tx =>
        tx.query(
          `insert into aura.product_media (org_id, product_id, url, created_by)
           values ($1, $2, 'http://example.test/image.png', aura.current_principal())`,
          [ORG_A, productId]
        )
      )
    ).rejects.toThrow(/check constraint|violates/i);
    const accepted = await as(OWNER_A, tx =>
      tx.query(
        `insert into aura.product_media (org_id, product_id, url, alt_text, created_by)
         values ($1, $2, 'https://cdn.example.test/image.png', 'Front view', aura.current_principal())
         returning id`,
        [ORG_A, productId]
      )
    );
    expect(accepted).toHaveLength(1);
  });

  it("keeps revisions and audit events append-only", async () => {
    const revision = await as(OWNER_A, async tx => {
      const rows = await submit(tx, ORG_A, productId);
      return rows[0]!;
    });
    // A seller cannot decide their own revision: the update matches no row.
    const selfDecision = await as(OWNER_A, tx =>
      tx.query(
        `update aura.product_revisions set decision = 'approved' where id = $1 returning id`,
        [revision.id]
      )
    );
    expect(selfDecision).toEqual([]);
    await expect(
      as(OPERATOR, tx =>
        tx.query(`delete from aura.product_revisions where id = $1`, [
          revision.id,
        ])
      )
    ).rejects.toThrow(/permission denied|denied/i);
    await expect(
      as(OWNER_A, tx =>
        tx.query(
          `update aura.audit_events set action = 'forged' where org_id = $1`,
          [ORG_A]
        )
      )
    ).rejects.toThrow(/permission denied|denied/i);
  });

  it("cannot approve a revision that was never decided", async () => {
    const pending = await as(OWNER_A, tx =>
      tx.query<{ id: string }>(
        `select id from aura.product_revisions
          where product_id = $1 and decision = 'pending'
          order by revision_number desc limit 1`,
        [productId]
      )
    );
    await as(OWNER_A, tx => setStatus(tx, productId, "submitted"));
    await expect(
      as(OPERATOR, tx =>
        tx.query(
          `update aura.products
              set status = 'approved', approved_revision_id = $2, approved_at = now()
            where id = $1`,
          [productId, pending[0]!.id]
        )
      )
    ).rejects.toThrow(/revision_not_approved/);
  });

  it("grants the runtime role no destructive or reference-data writes", async () => {
    const privileges = await admin.query<{
      product_delete: boolean;
      seller_delete: boolean;
      category_insert: boolean;
      audit_update: boolean;
      revision_delete: boolean;
    }>(
      `select has_table_privilege('aura_app', 'aura.products', 'DELETE') as product_delete,
              has_table_privilege('aura_app', 'aura.seller_profiles', 'DELETE') as seller_delete,
              has_table_privilege('aura_app', 'aura.categories', 'INSERT') as category_insert,
              has_table_privilege('aura_app', 'aura.audit_events', 'UPDATE') as audit_update,
              has_table_privilege('aura_app', 'aura.product_revisions', 'DELETE') as revision_delete`
    );
    expect(privileges[0]).toEqual({
      product_delete: false,
      seller_delete: false,
      category_insert: false,
      audit_update: false,
      revision_delete: false,
    });
  });
});

describe("platform review separation of duties", () => {
  const DUAL = "99999999-9999-4999-8999-999999999999";

  beforeAll(async () => {
    await admin.query(
      `insert into aura.principals (id, issuer, subject, email, display_name)
       values ($1, 'local', 'dual-role', 'dual-role@example.test', 'Dual Role')`,
      [DUAL]
    );
    await admin.query(
      `insert into aura.platform_admins (principal_id, note) values ($1, 'four-eyes fixture')`,
      [DUAL]
    );
    await admin.query(
      `insert into aura.memberships (org_id, principal_id, role) values ($1, $2, 'member')`,
      [ORG_A, DUAL]
    );
    // Put the organization's approved seller back under review so there is a
    // real decision for the dual-role administrator to attempt.
    await as(OWNER_A, tx =>
      tx.query(
        `update aura.seller_profiles set status = 'submitted' where org_id = $1`,
        [ORG_A]
      )
    );
  });

  afterAll(async () => {
    await as(OPERATOR, tx =>
      tx.query(
        `update aura.seller_profiles set status = 'approved'
          where org_id = $1 and status = 'submitted'`,
        [ORG_A]
      )
    );
    await admin.query(`delete from aura.memberships where principal_id = $1`, [
      DUAL,
    ]);
    await admin.query(
      `delete from aura.platform_admins where principal_id = $1`,
      [DUAL]
    );
  });

  it("refuses decisions from a dual-role administrator under direct SQL", async () => {
    // Seller application: approve and reject are both refused.
    await expect(
      as(DUAL, tx =>
        tx.query(
          `update aura.seller_profiles set status = 'approved' where org_id = $1`,
          [ORG_A]
        )
      )
    ).rejects.toThrow(/review_separation_required/);
    await expect(
      as(DUAL, tx =>
        tx.query(
          `update aura.seller_profiles
              set status = 'rejected', review_note = 'self review'
            where org_id = $1`,
          [ORG_A]
        )
      )
    ).rejects.toThrow(/review_separation_required/);

    // The same application is still decided by an unrelated administrator.
    const approved = await as(OPERATOR, tx =>
      tx.query<{ status: string }>(
        `update aura.seller_profiles set status = 'approved'
          where org_id = $1 returning status`,
        [ORG_A]
      )
    );
    expect(approved[0]?.status).toBe("approved");

    const product = await preparableProduct("Four Eyes Runner");
    const revisionId = await as(OWNER_A, async tx => {
      const rows = await submit(tx, ORG_A, product.id);
      await setStatus(tx, product.id, "submitted");
      return rows[0]!.id;
    });

    await expect(
      as(DUAL, tx =>
        tx.query(
          `update aura.product_revisions set decision = 'approved' where id = $1`,
          [revisionId]
        )
      )
    ).rejects.toThrow(/review_separation_required/);
    await expect(
      as(DUAL, tx =>
        tx.query(
          `update aura.product_revisions
              set decision = 'rejected', review_note = 'self review'
            where id = $1`,
          [revisionId]
        )
      )
    ).rejects.toThrow(/review_separation_required/);

    // The revision can be approved by the unrelated administrator, but the
    // dual-role administrator still cannot move the product itself.
    await as(OPERATOR, tx =>
      tx.query(
        `update aura.product_revisions set decision = 'approved' where id = $1`,
        [revisionId]
      )
    );
    await expect(
      as(DUAL, tx =>
        tx.query(
          `update aura.products
              set status = 'approved', approved_revision_id = $2
            where id = $1`,
          [product.id, revisionId]
        )
      )
    ).rejects.toThrow(/review_separation_required/);

    // The platform grant still authorizes ordinary review reads.
    const visible = await as(DUAL, tx =>
      tx.query<{ n: number }>(
        `select count(*)::int as n from aura.seller_profiles where org_id = $1`,
        [ORG_A]
      )
    );
    expect(visible[0]?.n).toBe(1);
  });
});
