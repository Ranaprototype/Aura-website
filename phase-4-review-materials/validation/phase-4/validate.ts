/**
 * Phase 4 planning validation — DISPOSABLE, read-only against the real repo.
 *
 * Executes the PROPOSED migrations in validation/phase-4/proposed/ on a fresh
 * in-memory PGlite (real PostgreSQL 18.6 WASM) after replaying the real
 * 0001-0007 ledger, then asserts the security and lifecycle behaviour the
 * Phase 4 plan claims. Nothing here is applied to supabase/migrations/, the
 * application, or any shared database.
 *
 * Run: node --import tsx validation/phase-4/validate.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const migrationsDir = path.join(root, "supabase/migrations");
const proposedDir = path.join(root, "validation/phase-4/proposed");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const db = new PGlite();
  await db.waitReady;
  const q = async (sql: string, params: unknown[] = []) =>
    (await db.query(sql, params)).rows as Record<string, any>[];
  const exec = async (sql: string) => db.exec(sql);

  // One transaction per unit of work; role and identity are transaction-local
  // exactly like the production PgDatabase contract.
  async function unit<T>(
    role: string | null,
    principal: string | null,
    fn: () => Promise<T>
  ): Promise<T> {
    await q("begin");
    try {
      if (role) await q(`set local role ${role}`);
      if (principal)
        await q("select set_config('aura.principal_id', $1, true)", [principal]);
      const out = await fn();
      await q("commit");
      return out;
    } catch (error) {
      await q("rollback");
      throw error;
    }
  }

  async function expectError(
    name: string,
    needle: string,
    fn: () => Promise<unknown>
  ) {
    try {
      await fn();
      ok(name, false, "expected an error, none was raised");
    } catch (error: any) {
      const text = `${error?.code ?? ""} ${error?.message ?? error}`;
      ok(name, text.includes(needle), `got: ${text.slice(0, 160)}`);
    }
  }

  const version = (await q("select version() as v"))[0].v as string;
  console.log(`Engine: ${version}\n`);

  // ---- Real ledger ---------------------------------------------------------
  const files = (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort();
  for (const file of files)
    await exec(await readFile(path.join(migrationsDir, file), "utf8"));
  console.log(`Replayed real migrations: ${files.join(", ")}\n`);

  // ---- Fixtures (operator handle models out-of-band provisioning) ----------
  const ids: Record<string, string> = {};
  const mkPrincipal = async (key: string, email: string) => {
    const rows = await q(
      `insert into aura.principals (issuer, subject, email, email_verified_at)
       values ('local', $1, $2, now()) returning id`,
      [key, email]
    );
    ids[key] = rows[0].id;
  };
  await mkPrincipal("ownerA", "owner-a@example.test");
  await mkPrincipal("memberA", "member-a@example.test");
  await mkPrincipal("ownerB", "owner-b@example.test");
  await mkPrincipal("adminP", "platform-admin@example.test");
  await mkPrincipal("adminD", "dual-role-admin@example.test");

  const orgA = (
    await unit("aura_app", ids.ownerA, () =>
      q("select (aura.create_organization('Org A', 'org-a')).id as id")
    )
  )[0].id;
  const orgB = (
    await unit("aura_app", ids.ownerB, () =>
      q("select (aura.create_organization('Org B', 'org-b')).id as id")
    )
  )[0].id;
  ids.orgA = orgA;
  ids.orgB = orgB;
  await q(
    `insert into aura.memberships (org_id, principal_id, role) values ($1, $2, 'member')`,
    [orgA, ids.memberA]
  );
  await q(`insert into aura.platform_admins (principal_id) values ($1), ($2)`, [
    ids.adminP,
    ids.adminD,
  ]);
  // Dual-role administrator: platform grant AND an active membership of A.
  await q(
    `insert into aura.memberships (org_id, principal_id, role) values ($1, $2, 'member')`,
    [orgA, ids.adminD]
  );

  const sneakers = (await q(`select id from aura.categories where slug = 'sneakers'`))[0].id;
  const upperMaterial = (
    await q(
      `select id from aura.category_attributes where category_id = $1 and key = 'upper-material'`,
      [sneakers]
    )
  )[0].id;

  const onboardSeller = async (org: string, owner: string, name: string) => {
    const seller = (
      await unit("aura_app", owner, () =>
        q(
          `insert into aura.seller_profiles
             (org_id, display_name, legal_name, business_email, country, created_by)
           values ($1, $2, $3, $4, 'IN', $5) returning id`,
          [org, name, `${name} Legal`, `hello@${name.toLowerCase().replace(/\s/g, "")}.test`, owner]
        )
      )
    )[0].id;
    await unit("aura_app", owner, () =>
      q(`update aura.seller_profiles set status = 'submitted' where id = $1`, [seller])
    );
    await unit("aura_app", ids.adminP, () =>
      q(`update aura.seller_profiles set status = 'approved' where id = $1`, [seller])
    );
    return seller;
  };
  const sellerA = await onboardSeller(orgA, ids.ownerA, "Aurora Studio");
  const sellerB = await onboardSeller(orgB, ids.ownerB, "Borealis Works");
  ids.sellerA = sellerA;
  ids.sellerB = sellerB;

  const createProduct = async (
    org: string,
    seller: string,
    writer: string,
    slug: string,
    title: string,
    ageDays: number
  ) =>
    (
      await unit("aura_app", writer, () =>
        q(
          `insert into aura.products
             (org_id, seller_profile_id, category_id, slug, title, created_by, created_at)
           values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' days')::interval) returning id`,
          [org, seller, sneakers, slug, title, writer, String(ageDays)]
        )
      )
    )[0].id;

  const furnish = async (product: string, org: string, writer: string, sku: string) => {
    await unit("aura_app", writer, async () => {
      await q(
        `insert into aura.product_variants (org_id, product_id, sku, title, size, colour, created_by)
         values ($1, $2, $3, 'Standard', '42', 'black', $4)`,
        [org, product, sku, writer]
      );
      await q(
        `insert into aura.product_media (org_id, product_id, kind, url, alt_text, created_by)
         values ($1, $2, 'image', 'https://images.example.test/photo.jpg', 'Photo', $3),
                ($1, $2, 'reference', 'https://images.example.test/mood.jpg', 'Mood', $3)`,
        [org, product, writer]
      );
      await q(
        `insert into aura.product_attribute_values (org_id, product_id, attribute_id, value)
         values ($1, $2, $3, 'knit')`,
        [org, product, upperMaterial]
      );
    });
  };

  const submitAndApprove = async (product: string, org: string, writer: string) => {
    const rev = (
      await unit("aura_app", writer, async () => {
        const rows = await q(
          `insert into aura.product_revisions (product_id, org_id, submitted_by)
           values ($1, $2, $3) returning id`,
          [product, org, writer]
        );
        await q(`update aura.products set status = 'submitted' where id = $1`, [product]);
        return rows;
      })
    )[0].id;
    await unit("aura_app", ids.adminP, async () => {
      await q(`update aura.product_revisions set decision = 'approved' where id = $1`, [rev]);
      await q(
        `update aura.products set status = 'approved', approved_revision_id = $2 where id = $1`,
        [product, rev]
      );
    });
    return rev;
  };

  // Org A: published, draft, submitted, archived, published-then-edited.
  const pA = await createProduct(orgA, sellerA, ids.memberA, "aurora-runner", "Aurora Runner", 2);
  await furnish(pA, orgA, ids.memberA, "A-1");
  const revA = await submitAndApprove(pA, orgA, ids.memberA);
  const pDraft = await createProduct(orgA, sellerA, ids.memberA, "draft-shoe", "Draft Shoe", 1);
  await furnish(pDraft, orgA, ids.memberA, "A-2");
  const pSubmitted = await createProduct(orgA, sellerA, ids.memberA, "pending-shoe", "Pending Shoe", 1);
  await furnish(pSubmitted, orgA, ids.memberA, "A-3");
  await unit("aura_app", ids.memberA, async () => {
    await q(
      `insert into aura.product_revisions (product_id, org_id, submitted_by) values ($1, $2, $3)`,
      [pSubmitted, orgA, ids.memberA]
    );
    await q(`update aura.products set status = 'submitted' where id = $1`, [pSubmitted]);
  });
  const pArchived = await createProduct(orgA, sellerA, ids.memberA, "old-shoe", "Old Shoe", 1);
  await unit("aura_app", ids.ownerA, () =>
    q(`update aura.products set status = 'archived' where id = $1`, [pArchived])
  );
  const pEdited = await createProduct(orgA, sellerA, ids.memberA, "edited-shoe", "Edited Shoe", 1);
  await furnish(pEdited, orgA, ids.memberA, "A-4");
  await submitAndApprove(pEdited, orgA, ids.memberA);
  await unit("aura_app", ids.memberA, () =>
    q(`update aura.products set title = 'Edited Shoe v2' where id = $1`, [pEdited])
  );
  // Org B: a cross-organization slug collision + one distinct published product.
  const pB = await createProduct(orgB, sellerB, ids.ownerB, "aurora-runner", "Borealis Runner", 1);
  await furnish(pB, orgB, ids.ownerB, "B-1");
  const revB = await submitAndApprove(pB, orgB, ids.ownerB);
  const pB2 = await createProduct(orgB, sellerB, ids.ownerB, "b-runner", "Borealis Classic", 1);
  await furnish(pB2, orgB, ids.ownerB, "B-2");
  await submitAndApprove(pB2, orgB, ids.ownerB);
  ids.pA = pA; ids.pB = pB; ids.pB2 = pB2; ids.revA = revA; ids.revB = revB;

  // Org C: an UNAPPROVED seller that still has an approved product (item 4
  // defense-in-depth fixture). A material business-info change returns an
  // approved seller to draft (the designed re-review path), leaving pC approved
  // under a now-unapproved seller.
  await mkPrincipal("ownerC", "owner-c@example.test");
  const orgC = (await unit("aura_app", ids.ownerC, () =>
    q(`select (aura.create_organization('Org C', 'org-c')).id as id`)))[0].id;
  ids.orgC = orgC;
  const sellerC = await onboardSeller(orgC, ids.ownerC, "Cypress Works");
  ids.sellerC = sellerC;
  const pC = await createProduct(orgC, sellerC, ids.ownerC, "cypress-runner", "Cypress Runner", 1);
  await furnish(pC, orgC, ids.ownerC, "C-1");
  await submitAndApprove(pC, orgC, ids.ownerC);
  ids.pC = pC;
  await unit("aura_app", ids.ownerC, () =>
    q(`update aura.seller_profiles set legal_name = 'Cypress Works Revised Legal' where id = $1`, [sellerC]));

  // ---- Catalog owner (item 3): a NON-superuser, NOBYPASSRLS role owns the base
  //      tables + schema; 0008 §8 (re)assigns the definer views to it. ---------
  await q(`create role aura_catalog_owner nologin nosuperuser nobypassrls nocreaterole nocreatedb`);
  await q(`alter schema aura owner to aura_catalog_owner`);
  for (const t of ["products", "seller_profiles", "product_variants", "product_media",
                   "product_attribute_values", "categories", "category_attributes"])
    await q(`alter table aura.${t} owner to aura_catalog_owner`);

  // ---- Proposed 0008 -------------------------------------------------------
  await exec(await readFile(path.join(proposedDir, "0008_public_storefront.sql"), "utf8"));
  console.log("Applied proposed 0008_public_storefront.sql\n");

  // == Group 1: roles, ZERO base grants, function EXECUTE =====================
  const pubRole = (
    await q(`select rolcanlogin, rolinherit, rolsuper, rolbypassrls from pg_roles where rolname = 'aura_public'`)
  )[0];
  ok("1.1 aura_public is nologin/noinherit/nosuperuser/nobypassrls",
    !pubRole.rolcanlogin && !pubRole.rolinherit && !pubRole.rolsuper && !pubRole.rolbypassrls);
  ok("1.2 schema USAGE granted to aura_public, revoked from PUBLIC",
    (await q(`select has_schema_privilege('aura_public', 'aura', 'USAGE') as ok`))[0].ok &&
    !(await q(`select has_schema_privilege('public', 'aura', 'USAGE') as ok`))[0].ok);
  const baseTables = ["products", "seller_profiles", "product_variants", "product_media",
    "product_attribute_values", "categories", "category_attributes", "slug_redirects"];
  let noBase = true;
  for (const t of baseTables)
    if ((await q(`select has_table_privilege('aura_public', 'aura.${t}', 'SELECT') as ok`))[0].ok)
      noBase = false;
  ok("1.3 aura_public has ZERO table-level SELECT on catalogue/reference base tables", noBase);
  let noCols = true;
  for (const [t, c] of [["products","slug"],["products","org_id"],["products","approved_revision_id"],
    ["products","seller_profile_id"],["seller_profiles","legal_name"],["seller_profiles","display_name"],
    ["product_variants","sku"],["slug_redirects","slug"]])
    if ((await q(`select has_column_privilege('aura_public', 'aura.${t}', '${c}', 'SELECT') as ok`))[0].ok)
      noCols = false;
  ok("1.4 aura_public has ZERO column privileges (internal ids + seller fields unreachable)", noCols);
  const pubViews = ["public_products", "public_product_variants", "public_product_media",
    "public_product_attributes", "public_slug_redirects"];
  let viewsGranted = true;
  for (const v of pubViews)
    if (!(await q(`select has_table_privilege('aura_public', 'aura.${v}', 'SELECT') as ok`))[0].ok)
      viewsGranted = false;
  ok("1.5 aura_public has SELECT on the five public definer views only", viewsGranted);
  const forbiddenTables = ["principals", "credentials", "sessions", "auth_tokens", "memberships",
    "organizations", "invitations", "projects", "audit_events", "platform_admins",
    "auth_rate_limits", "email_events", "email_rate_limits"];
  let allDenied = true;
  for (const t of forbiddenTables)
    for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"])
      if ((await q(`select has_table_privilege('aura_public', 'aura.${t}', '${priv}') as ok`))[0].ok)
        allDenied = false;
  ok("1.6 aura_public has no privilege on identity/tenancy/audit/auth-rate tables", allDenied);
  const helperFns = ["aura.is_platform_admin()", "aura.is_active_member(uuid, text[])",
    "aura.current_principal()", "aura.current_org()", "aura.create_organization(text, text)",
    "aura.build_product_snapshot(uuid)", "aura.set_member_role(uuid, uuid, text)",
    "aura.seller_suspension_note(uuid)"];
  let fnDenied = true;
  for (const f of helperFns)
    if ((await q(`select has_function_privilege('aura_public', '${f}', 'EXECUTE') as ok`))[0].ok)
      fnDenied = false;
  ok("1.7 aura_public cannot EXECUTE any identity/security-definer helper", fnDenied);
  ok("1.8 PUBLIC EXECUTE stripped (touch_updated_at, suspension guards); aura_app granted",
    !(await q(`select has_function_privilege('public', 'aura.touch_updated_at()', 'EXECUTE') as ok`))[0].ok &&
    !(await q(`select has_function_privilege('public', 'aura.seller_suspension_guard()', 'EXECUTE') as ok`))[0].ok &&
    (await q(`select has_function_privilege('aura_app', 'aura.seller_suspension_guard()', 'EXECUTE') as ok`))[0].ok);
  await unit("aura_app", ids.memberA, () =>
    q(`update aura.products set summary = 'touch probe' where id = $1`, [pDraft])
  );
  ok("1.9 touch_updated_at trigger still fires with PUBLIC EXECUTE revoked",
    (await q(`select updated_at > created_at as ok from aura.products where id = $1`, [pDraft]))[0].ok);
  await q(`create role aura_public_login login password 'validation-only'`);
  await q(`grant aura_public to aura_public_login`);
  const viaLogin = await unit("aura_public_login", null, () =>
    q(`select count(*)::int as n from aura.public_products`)
  );
  ok("1.10 LOGIN role inheriting aura_public reads the public projection (role inheritance)",
    viaLogin[0].n === 3, `n=${viaLogin[0].n}`);
  ok("1.11 inherited login still cannot EXECUTE helpers",
    !(await q(`select has_function_privilege('aura_public_login', 'aura.is_platform_admin()', 'EXECUTE') as ok`))[0].ok);
  const scopedPolicies = (await q(
    `select count(*)::int as n from pg_policies pol
     where pol.schemaname = 'aura'
       and pol.policyname not in ('categories_read', 'category_attributes_read',
                                  'seller_profiles_public_select', 'products_public_select',
                                  'product_variants_public_select', 'product_media_public_select',
                                  'product_attribute_values_public_select', 'slug_redirects_public_select',
                                  'public_rate_limits_public_all')
       and pol.roles <> '{aura_app}'`)
  )[0].n;
  ok("1.12 every helper-calling policy is scoped TO aura_app", scopedPolicies === 0, `unscoped=${scopedPolicies}`);
  ok("1.13 reference-data policy categories_read remains PUBLIC (definition unchanged)",
    JSON.stringify((await q(`select roles from pg_policies where schemaname = 'aura' and policyname = 'categories_read'`))[0].roles) === JSON.stringify(["public"]));
  const viewOpts = (await q(
    `select coalesce(reloptions::text, '') as ro from pg_class
      where relname = 'public_products' and relnamespace = (select oid from pg_namespace where nspname = 'aura')`)
  )[0].ro;
  ok("1.14 public_products is a SECURITY DEFINER view (not security_invoker)",
    !viewOpts.includes("security_invoker=true"), viewOpts);
  ok("1.15 aura_app column grants hide suspension_note but keep status/overlay columns (D-03)",
    !(await q(`select has_column_privilege('aura_app', 'aura.seller_profiles', 'suspension_note', 'SELECT') as ok`))[0].ok &&
    (await q(`select has_column_privilege('aura_app', 'aura.seller_profiles', 'display_name', 'SELECT') as ok`))[0].ok &&
    (await q(`select has_column_privilege('aura_app', 'aura.seller_profiles', 'suspended_at', 'SELECT') as ok`))[0].ok &&
    (await q(`select has_function_privilege('aura_app', 'aura.seller_suspension_note(uuid)', 'EXECUTE') as ok`))[0].ok);
  const definerViews = ["public_products", "public_product_variants", "public_product_media",
    "public_product_attributes", "public_slug_redirects"];
  const viewOwners = await q(
    `select c.relname, r.rolname as owner from pg_class c join pg_roles r on r.oid = c.relowner
      where c.relnamespace = (select oid from pg_namespace where nspname = 'aura')
        and c.relname = any($1)`, [definerViews]);
  ok("1.16 all five definer views are owned by the catalog owner (not a privileged migration role)",
    viewOwners.length === 5 && viewOwners.every(r => r.owner === "aura_catalog_owner"),
    JSON.stringify(viewOwners));
  const catOwner = (await q(
    `select rolcanlogin, rolsuper, rolbypassrls from pg_roles where rolname = 'aura_catalog_owner'`))[0];
  const baseOwned = (await q(
    `select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner
      where c.relnamespace = (select oid from pg_namespace where nspname = 'aura')
        and c.relname = any($1) and r.rolname = 'aura_catalog_owner'`,
    [["products", "seller_profiles", "product_variants", "product_media",
      "product_attribute_values", "categories", "category_attributes", "slug_redirects"]]))[0].n;
  ok("1.17 catalog owner is nologin/nosuperuser/nobypassrls and owns every base table the views read",
    !catOwner.rolcanlogin && !catOwner.rolsuper && !catOwner.rolbypassrls && baseOwned === 8,
    `baseOwned=${baseOwned}`);
  const invokerFlags = await q(
    `select c.relname, coalesce(c.reloptions::text, '') as ro from pg_class c
      where c.relnamespace = (select oid from pg_namespace where nspname = 'aura')
        and c.relname = any($1)`, [definerViews]);
  ok("1.18 all five public views are SECURITY DEFINER (security_invoker not set)",
    invokerFlags.length === 5 && invokerFlags.every(r => !r.ro.includes("security_invoker=true")),
    JSON.stringify(invokerFlags));
  let effViews = true, effBase = false;
  for (const v of definerViews)
    if (!(await q(`select has_table_privilege('aura_public', 'aura.${v}', 'SELECT') as ok`))[0].ok) effViews = false;
  for (const t of ["products", "seller_profiles", "product_variants", "product_media",
                   "product_attribute_values", "categories", "category_attributes", "slug_redirects"])
    if ((await q(`select has_table_privilege('aura_public', 'aura.${t}', 'SELECT') as ok`))[0].ok) effBase = true;
  ok("1.19 effective grants: aura_public SELECT on the five views only, zero base-table SELECT",
    effViews && !effBase);

  // -- Ownership-procedure proofs (AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md).
  //    These prove the deployment prerequisites the runbook states: executor
  //    membership enables the §8 reassignment, a non-member is denied, a member
  //    of the table owner bypasses catalog RLS (ENABLE not FORCE), the note
  //    accessor's owner needs explicit helper EXECUTE, and a public login
  //    inherits view-only access. All use scratch objects that are cleaned up.
  await q(`create role aura_migrator_probe login createrole nosuperuser nobypassrls nocreatedb password 'probe'`);
  await q(`grant aura_catalog_owner to aura_migrator_probe`);
  await q(`create view aura._probe_mem as select 1 as x`);
  await q(`alter view aura._probe_mem owner to aura_migrator_probe`);
  await unit("aura_migrator_probe", null, () =>
    q(`alter view aura._probe_mem owner to aura_catalog_owner`));
  const memOwner = (await q(
    `select r.rolname as owner from pg_class c join pg_roles r on r.oid=c.relowner
      where c.relnamespace=(select oid from pg_namespace where nspname='aura') and c.relname='_probe_mem'`))[0].owner;
  ok("1.20 member executor (CREATEROLE + catalog-owner membership) can reassign a definer view to the catalog owner",
    memOwner === "aura_catalog_owner", `owner=${memOwner}`);
  await q(`drop view aura._probe_mem`);

  await q(`create role aura_outsider_probe login createrole nosuperuser nobypassrls nocreatedb password 'probe'`);
  await q(`create view aura._probe_out as select 1 as x`);
  await q(`alter view aura._probe_out owner to aura_outsider_probe`);
  let outsiderDenied = false;
  try {
    await unit("aura_outsider_probe", null, () =>
      q(`alter view aura._probe_out owner to aura_catalog_owner`));
  } catch { outsiderDenied = true; }
  ok("1.21 non-member executor is DENIED ownership reassignment to the catalog owner",
    outsiderDenied);
  await q(`drop view aura._probe_out`);
  await q(`drop role aura_outsider_probe`);

  await q(`create table aura._probe_rls (id int)`);
  await q(`alter table aura._probe_rls owner to aura_catalog_owner`);
  await q(`alter table aura._probe_rls enable row level security`);
  await q(`grant select on aura._probe_rls to aura_app`);
  await q(`create policy _probe_deny on aura._probe_rls for select to aura_app using (false)`);
  await q(`insert into aura._probe_rls values (1),(2),(3)`);
  const memberCount = (await unit("aura_migrator_probe", null, () =>
    q(`select count(*)::int as n from aura._probe_rls`)))[0].n;
  const appCount = (await unit("aura_app", null, () =>
    q(`select count(*)::int as n from aura._probe_rls`)))[0].n;
  ok("1.22 a non-superuser MEMBER of the table owner bypasses catalog RLS (owner exemption); a non-member is filtered",
    memberCount === 3 && appCount === 0, `member=${memberCount} app=${appCount}`);
  await q(`drop table aura._probe_rls`);
  await q(`drop role aura_migrator_probe`);

  const helperBefore = (await q(
    `select has_function_privilege('aura_catalog_owner','aura.is_active_member(uuid,text[])','EXECUTE') as ok`))[0].ok;
  await q(`grant execute on function aura.is_active_member(uuid,text[]) to aura_catalog_owner`);
  await q(`grant execute on function aura.is_platform_admin() to aura_catalog_owner`);
  const helperAfter = (await q(
    `select has_function_privilege('aura_catalog_owner','aura.is_active_member(uuid,text[])','EXECUTE') as m,
            has_function_privilege('aura_catalog_owner','aura.is_platform_admin()','EXECUTE') as p`))[0];
  await q(`revoke execute on function aura.is_active_member(uuid,text[]) from aura_catalog_owner`);
  await q(`revoke execute on function aura.is_platform_admin() from aura_catalog_owner`);
  ok("1.23 note-accessor owner needs explicit helper EXECUTE (denied before grant, allowed after; PUBLIC never has it)",
    helperBefore === false && helperAfter.m === true && helperAfter.p === true);

  await q(`create role aura_public_login_probe login password 'probe'`);
  await q(`grant aura_public to aura_public_login_probe`);
  const loginView = (await q(`select has_table_privilege('aura_public_login_probe','aura.public_products','SELECT') as ok`))[0].ok;
  const loginBase = (await q(`select has_table_privilege('aura_public_login_probe','aura.products','SELECT') as ok`))[0].ok;
  ok("1.24 public LOGIN inheriting aura_public gets view SELECT only, zero base-table SELECT",
    loginView === true && loginBase === false);
  await q(`revoke aura_public from aura_public_login_probe`);
  await q(`drop role aura_public_login_probe`);

  // == Group 2: anonymous reads via definer views; base tables fully denied ====
  const pub = await unit("aura_public", null, () =>
    q(`select slug from aura.public_products order by slug`)
  );
  ok("2.1 public projection shows exactly the three published products (pre-0009 duplicate slug twice)",
    JSON.stringify(pub.map(r => r.slug)) === JSON.stringify(["aurora-runner", "aurora-runner", "b-runner"]),
    JSON.stringify(pub));
  const media = await unit("aura_public", null, () =>
    q(`select kind, url from aura.public_product_media where product_slug = 'b-runner'`)
  );
  ok("2.2 public media is image-only (reference kind hidden)",
    media.length === 1 && media[0].kind === "image");
  const variantCols = (
    await q(`select column_name from information_schema.columns
             where table_schema = 'aura' and table_name = 'public_product_variants' order by column_name`)
  ).map(r => r.column_name);
  ok("2.3 variant view allowlist (no id, no sku; keyed by product_slug)",
    JSON.stringify(variantCols) === JSON.stringify(["colour", "material", "position", "product_slug", "size", "title"]),
    JSON.stringify(variantCols));
  const attrs = await unit("aura_public", null, () =>
    q(`select key, value from aura.public_product_attributes where product_slug = 'b-runner'`)
  );
  ok("2.4 public attributes expose key/label/value (no attribute id)",
    attrs.length === 1 && attrs[0].key === "upper-material" && attrs[0].value === "knit");
  const productCols = (
    await q(`select column_name from information_schema.columns
             where table_schema = 'aura' and table_name = 'public_products' order by column_name`)
  ).map(r => r.column_name);
  ok("2.5 product view allowlist (no org/product/revision id, no seller fields)",
    JSON.stringify(productCols) === JSON.stringify(["approved_at", "category_name", "category_slug", "description", "slug", "summary", "title"]),
    JSON.stringify(productCols));
  await expectError("2.6 direct base read of products is DENIED (zero base grants)", "permission denied", () =>
    unit("aura_public", null, () => q(`select slug from aura.products`))
  );
  await expectError("2.7 direct base read of seller_profiles is DENIED", "permission denied", () =>
    unit("aura_public", null, () => q(`select display_name from aura.seller_profiles`))
  );
  await expectError("2.8 SELECT * on base table denied", "permission denied", () =>
    unit("aura_public", null, () => q(`select * from aura.products`))
  );
  const draftChildren = await unit("aura_public", null, () =>
    q(`select count(*)::int as n from aura.public_product_variants where product_slug = 'draft-shoe'`)
  );
  ok("2.9 child rows of a draft product are invisible in the public view", draftChildren[0].n === 0);
  const forged = await unit("aura_public", null, async () => {
    await q("select set_config('aura.principal_id', $1, true)", [ids.ownerA]);
    return q(`select slug from aura.public_products order by slug`);
  });
  ok("2.10 forged aura.principal_id has no effect on the public path",
    JSON.stringify(forged.map(r => r.slug)) === JSON.stringify(["aurora-runner", "aurora-runner", "b-runner"]));
  await expectError("2.11 public role cannot read identity tables even with forged identity", "permission denied", () =>
    unit("aura_public", null, async () => {
      await q("select set_config('aura.principal_id', $1, true)", [ids.ownerA]);
      return q(`select email from aura.principals`);
    })
  );
  await expectError("2.12 public INSERT denied", "permission denied", () =>
    unit("aura_public", null, () =>
      q(`insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
         values ($1, $2, $3, 'evil-shoe', 'Evil Shoe', $4)`, [orgA, sellerA, sneakers, ids.memberA]))
  );
  await expectError("2.13 public UPDATE denied", "permission denied", () =>
    unit("aura_public", null, () => q(`update aura.products set title = 'x' where slug = 'b-runner'`))
  );
  await expectError("2.14 public DELETE denied", "permission denied", () =>
    unit("aura_public", null, () => q(`delete from aura.product_variants`))
  );
  const memberView = await unit("aura_app", ids.memberA, () =>
    q(`select count(*)::int as n from aura.products where org_id = $1`, [orgA])
  );
  const crossView = await unit("aura_app", ids.memberA, () =>
    q(`select count(*)::int as n from aura.products where org_id = $1`, [orgB])
  );
  ok("2.15 aura_app member behaviour unchanged (own drafts visible, cross-tenant denied)",
    memberView[0].n === 5 && crossView[0].n === 0);
  const listRows = await unit("aura_public", null, () =>
    q(`select p.slug, p.title, p.summary, p.approved_at, p.category_slug, p.category_name,
              (select m.url from aura.public_product_media m
                where m.product_slug = p.slug order by m.position limit 1) as hero_image
         from aura.public_products p
        where ($1::text is null or p.category_slug = $1)
          and ($2::text is null
               or to_tsvector('simple', p.title || ' ' || coalesce(p.summary, ''))
                  @@ websearch_to_tsquery('simple', $2))
          and ($3::text is null or exists (
                select 1 from aura.public_product_attributes a
                 where a.product_slug = p.slug and a.key = $3 and a.value = $4))
          and ($5::timestamptz is null or (p.approved_at, p.slug) < ($5, $6))
        order by p.approved_at desc, p.slug desc
        limit $7`, [null, null, null, null, null, null, 24])
  );
  ok("2.16 exact API list query (search/filter/sort capable) runs as aura_public; slug keyset, no ids/seller",
    listRows.length === 3 && listRows.every(r => r.hero_image && r.category_slug === "sneakers"),
    JSON.stringify(listRows.map(r => r.slug)));
  const catFilter = await unit("aura_public", null, () =>
    q(`select count(*)::int as n from aura.public_products where category_slug = 'apparel'`)
  );
  ok("2.17 category filter narrows correctly (apparel has no published products)", catFilter[0].n === 0);
  const searchRows = await unit("aura_public", null, () =>
    q(`select slug from aura.public_products
        where to_tsvector('simple', title || ' ' || coalesce(summary, ''))
              @@ websearch_to_tsquery('simple', $1)
        order by approved_at desc, slug desc`, ["aurora"])
  );
  ok("2.18 search narrows by term on the definer view (no base access, no new fields)",
    searchRows.length === 1 && searchRows[0].slug === "aurora-runner", JSON.stringify(searchRows));
  const attrKnit = await unit("aura_public", null, () =>
    q(`select count(*)::int as n from aura.public_products p
        where exists (select 1 from aura.public_product_attributes a
                       where a.product_slug = p.slug and a.key = 'upper-material' and a.value = 'knit')`)
  );
  const attrLeather = await unit("aura_public", null, () =>
    q(`select count(*)::int as n from aura.public_products p
        where exists (select 1 from aura.public_product_attributes a
                       where a.product_slug = p.slug and a.key = 'upper-material' and a.value = 'leather')`)
  );
  ok("2.19 attribute-value filter narrows via the public attributes view (knit=3, leather=0)",
    attrKnit[0].n === 3 && attrLeather[0].n === 0, `knit=${attrKnit[0].n} leather=${attrLeather[0].n}`);
  const titleSort = await unit("aura_public", null, () =>
    q(`select title from aura.public_products order by title asc, slug asc`)
  );
  ok("2.20 selectable title sort orders correctly (title asc, slug tie-break)",
    JSON.stringify(titleSort.map(r => r.title)) ===
    JSON.stringify(["Aurora Runner", "Borealis Classic", "Borealis Runner"]),
    JSON.stringify(titleSort.map(r => r.title)));

  // == Group 2D: defense-in-depth — simulate an accidental base-table grant ====
  // (owner item 4). With base SELECT temporarily granted to aura_public, the
  // public policies must STILL hide suspended and unapproved sellers across
  // products and every child table. Grants are revoked afterwards (finally).
  const didTables = ["products", "seller_profiles", "product_variants", "product_media", "product_attribute_values"];
  await q(`grant select on ${didTables.map(t => `aura.${t}`).join(", ")} to aura_public`);
  try {
    await unit("aura_app", ids.adminP, () =>
      q(`update aura.seller_profiles set suspended_at = now(), suspension_note = 'did test' where id = $1`, [sellerA]));
    const n = async (sql: string, params: unknown[]) =>
      (await unit("aura_public", null, () => q(sql, params)))[0].n;
    ok("2.21 defense-in-depth: suspended seller's products hidden even with a base grant",
      (await n(`select count(*)::int as n from aura.products where seller_profile_id = $1`, [sellerA])) === 0);
    ok("2.22 defense-in-depth: suspended seller's variants hidden",
      (await n(`select count(*)::int as n from aura.product_variants where product_id = $1`, [pA])) === 0);
    ok("2.23 defense-in-depth: suspended seller's media hidden",
      (await n(`select count(*)::int as n from aura.product_media where product_id = $1`, [pA])) === 0);
    ok("2.24 defense-in-depth: suspended seller's attributes hidden",
      (await n(`select count(*)::int as n from aura.product_attribute_values where product_id = $1`, [pA])) === 0);
    await unit("aura_app", ids.adminP, () =>
      q(`update aura.seller_profiles set suspended_at = null where id = $1`, [sellerA]));
    ok("2.25 defense-in-depth: unapproved seller's products hidden even with a base grant",
      (await n(`select count(*)::int as n from aura.products where seller_profile_id = $1`, [sellerC])) === 0);
    ok("2.26 defense-in-depth: unapproved seller's variants hidden",
      (await n(`select count(*)::int as n from aura.product_variants where product_id = $1`, [pC])) === 0);
    ok("2.27 defense-in-depth: unapproved seller's media hidden",
      (await n(`select count(*)::int as n from aura.product_media where product_id = $1`, [pC])) === 0);
    ok("2.28 defense-in-depth: unapproved seller's attributes hidden",
      (await n(`select count(*)::int as n from aura.product_attribute_values where product_id = $1`, [pC])) === 0);
  } finally {
    await q(`revoke select on ${didTables.map(t => `aura.${t}`).join(", ")} from aura_public`);
  }
  let zeroAgain = true;
  for (const t of didTables)
    if ((await q(`select has_table_privilege('aura_public', 'aura.${t}', 'SELECT') as ok`))[0].ok) zeroAgain = false;
  ok("2.29 base grants revoked; aura_public back to zero base-table SELECT", zeroAgain);

  // == Group 3: suspension + confidential note (D-03) ==========================
  await expectError("3.1 four-eyes: dual-role admin cannot suspend their own org", "review_separation_required", () =>
    unit("aura_app", ids.adminD, () =>
      q(`update aura.seller_profiles set suspended_at = now(), suspension_note = 'x' where id = $1`, [sellerA]))
  );
  await unit("aura_app", ids.adminP, () =>
    q(`update aura.seller_profiles set suspended_at = now(), suspension_note = 'policy review' where id = $1`, [sellerA])
  );
  const suspState = (await q(`select s.status, s.suspended_by, p.approved_revision_id from aura.seller_profiles s
     join aura.products p on p.seller_profile_id = s.id where s.id = $1 and p.id = $2`, [sellerA, pA]))[0];
  ok("3.2 suspension preserves status and product approval state",
    suspState.status === "approved" && suspState.suspended_by === ids.adminP && suspState.approved_revision_id === revA);
  const suspPublic = await unit("aura_public", null, () =>
    q(`select slug from aura.public_products order by slug`)
  );
  ok("3.3 suspended seller's products leave the public projection immediately",
    JSON.stringify(suspPublic.map(r => r.slug)) === JSON.stringify(["aurora-runner", "b-runner"]),
    JSON.stringify(suspPublic));
  const suspChildren = await unit("aura_public", null, () =>
    q(`select count(*)::int as n from aura.public_product_media where product_slug = 'aurora-runner'`)
  );
  ok("3.4 suspended seller's media/variants also leave the public views",
    suspChildren[0].n === 1, `n=${suspChildren[0].n}`); // only org B's aurora-runner remains
  const suspAudit = (await q(`select actor_principal_id, detail->>'noteRecorded' as recorded, detail->>'suspensionNote' as raw
     from aura.audit_events where entity_id = $1 and action = 'seller.suspended'`, [sellerA]))[0];
  ok("3.5 seller.suspended audit records actor + noteRecorded, NOT the confidential note text",
    suspAudit?.actor_principal_id === ids.adminP && suspAudit?.recorded === "true" && suspAudit?.raw === null);
  await expectError("3.6 ordinary member cannot SELECT the suspension_note column", "permission denied", () =>
    unit("aura_app", ids.memberA, () =>
      q(`select suspension_note from aura.seller_profiles where org_id = $1`, [orgA]))
  );
  const ownerNote = await unit("aura_app", ids.ownerA, () =>
    q(`select aura.seller_suspension_note($1) as note`, [orgA])
  );
  ok("3.7 seller owner reads the note via the authorized accessor", ownerNote[0].note === "policy review");
  await expectError("3.8 ordinary member calling the accessor is refused", "forbidden", () =>
    unit("aura_app", ids.memberA, () => q(`select aura.seller_suspension_note($1)`, [orgA]))
  );
  await expectError("3.9 cross-organization owner cannot read the note", "forbidden", () =>
    unit("aura_app", ids.ownerB, () => q(`select aura.seller_suspension_note($1)`, [orgA]))
  );
  const adminNote = await unit("aura_app", ids.adminP, () =>
    q(`select aura.seller_suspension_note($1) as note`, [orgA])
  );
  ok("3.10 platform administrator reads the note via the accessor", adminNote[0].note === "policy review");
  await expectError("3.11 four-eyes: dual-role admin cannot restore their own org", "review_separation_required", () =>
    unit("aura_app", ids.adminD, () =>
      q(`update aura.seller_profiles set suspended_at = null where id = $1`, [sellerA]))
  );
  const outsiderRestore = await unit("aura_app", ids.ownerB, () =>
    q(`update aura.seller_profiles set suspended_at = null where id = $1 returning id`, [sellerA])
  );
  ok("3.12 non-member non-admin restore matches zero rows (RLS)", outsiderRestore.length === 0);
  await expectError("3.13 non-admin member restore refused (suspension guard fires first)", "forbidden", () =>
    unit("aura_app", ids.ownerA, () =>
      q(`update aura.seller_profiles set suspended_at = null where id = $1`, [sellerA]))
  );
  await expectError("3.14 suspension requires a note", "suspension_note_required", () =>
    unit("aura_app", ids.adminP, async () => {
      await q(`update aura.seller_profiles set suspended_at = null where id = $1`, [sellerB]);
      await q(`update aura.seller_profiles set suspended_at = now() where id = $1`, [sellerB]);
    })
  );
  await expectError("3.15 suspended seller cannot create products", "seller_suspended", () =>
    unit("aura_app", ids.memberA, () =>
      q(`insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
         values ($1, $2, $3, 'susp-shoe', 'Susp Shoe', $4)`, [orgA, sellerA, sneakers, ids.memberA]))
  );
  await expectError("3.16 suspended seller cannot edit draft content", "seller_suspended", () =>
    unit("aura_app", ids.memberA, () =>
      q(`update aura.products set title = 'New title' where id = $1`, [pDraft]))
  );
  await expectError("3.17 suspended seller cannot change child rows", "seller_suspended", () =>
    unit("aura_app", ids.memberA, () =>
      q(`insert into aura.product_variants (org_id, product_id, sku, title, created_by)
         values ($1, $2, 'A-9', 'Extra', $3)`, [orgA, pDraft, ids.memberA]))
  );
  await expectError("3.18 suspended seller cannot edit the profile", "seller_suspended", () =>
    unit("aura_app", ids.ownerA, () =>
      q(`update aura.seller_profiles set description = 'new' where id = $1`, [sellerA]))
  );
  const submittedRev = (await q(`select id from aura.product_revisions where product_id = $1 and decision = 'pending'`, [pSubmitted]))[0].id;
  await unit("aura_app", ids.adminP, async () => {
    await q(`update aura.product_revisions set decision = 'approved' where id = $1`, [submittedRev]);
    await q(`update aura.products set status = 'approved', approved_revision_id = $2 where id = $1`, [pSubmitted, submittedRev]);
  });
  ok("3.19 platform admin can still decide a submitted product while seller suspended",
    (await q(`select status from aura.products where id = $1`, [pSubmitted]))[0].status === "approved");
  await expectError("3.20 suspension must be atomic (no mixed content edit)", "suspension_must_be_atomic", () =>
    unit("aura_app", ids.adminP, () =>
      q(`update aura.seller_profiles set suspended_at = now(), suspension_note = 'x', display_name = 'Changed' where id = $1`, [sellerB]))
  );
  await unit("aura_app", ids.adminP, () =>
    q(`update aura.seller_profiles set suspended_at = null where id = $1`, [sellerA])
  );
  const restored = (await q(`select status, suspended_at, suspended_by, suspension_note from aura.seller_profiles where id = $1`, [sellerA]))[0];
  const restoredPublic = await unit("aura_public", null, () =>
    q(`select slug from aura.public_products order by slug`)
  );
  ok("3.21 restoration clears the overlay and preserves prior state",
    restored.status === "approved" && restored.suspended_at === null && restored.suspended_by === null && restored.suspension_note === null);
  ok("3.22 restored products reappear with the same approval (plus the admin-approved one)",
    JSON.stringify(restoredPublic.map(r => r.slug)) ===
    JSON.stringify(["aurora-runner", "aurora-runner", "b-runner", "pending-shoe"]),
    JSON.stringify(restoredPublic));
  ok("3.23 seller.restored audit event exists (>=1; the item-4 defense-in-depth block also restores sellerA)",
    (await q(`select count(*)::int as n from aura.audit_events where entity_id = $1 and action = 'seller.restored'`, [sellerA]))[0].n >= 1);
  ok("3.24 approved_revision_id unchanged through suspend/restore",
    (await q(`select approved_revision_id from aura.products where id = $1`, [pA]))[0].approved_revision_id === revA);
  const noteAfterRestore = await unit("aura_app", ids.ownerA, () =>
    q(`select aura.seller_suspension_note($1) as note`, [orgA])
  );
  ok("3.25 accessor returns null after restoration (note cleared, overlay reversible)",
    noteAfterRestore[0].note === null);

  // == Group 4: global slugs ===================================================
  await expectError("4.1 backfill without trigger handling fails (identity_required)", "identity_required", () =>
    q(`update aura.products set slug = 'renamed-probe' where id = $1`, [pB])
  );
  await unit("aura_app", ids.adminP, () =>
    q(`update aura.seller_profiles set suspended_at = now(), suspension_note = 'collision test' where id = $1`, [sellerB])
  );
  await expectError("4.2 slug rename on a suspended seller fails without trigger handling", "seller_suspended", () =>
    unit("aura_app", ids.adminP, () =>
      q(`update aura.products set slug = 'renamed-probe-2' where id = $1`, [pB]))
  );
  const beforeUpdate = (await q(`select updated_at from aura.products where id = $1`, [pB]))[0].updated_at;
  await exec(await readFile(path.join(proposedDir, "0009_global_product_slugs.sql"), "utf8"));
  console.log("\nApplied proposed 0009_global_product_slugs.sql\n");
  const slugsAfter = await q(`select id, slug from aura.products where id in ($1, $2) order by created_at`, [pA, pB]);
  const redirect = (await q(`select slug, replacement_slug, reason from aura.slug_redirects where product_id = $1`, [pB]))[0];
  ok("4.3 earliest product keeps the slug; later duplicate renamed deterministically",
    slugsAfter[0].slug === "aurora-runner" && slugsAfter[1].slug === `aurora-runner-${pB.slice(0, 8)}`,
    JSON.stringify(slugsAfter));
  ok("4.4 collision redirect recorded with replacement slug",
    redirect?.slug === "aurora-runner" && redirect?.replacement_slug === slugsAfter[1].slug && redirect?.reason === "global_collision");
  ok("4.5 global unique index present; per-org constraint preserved",
    (await q(`select count(*)::int as n from pg_indexes where schemaname = 'aura' and indexname = 'products_slug_global_key'`))[0].n === 1 &&
    (await q(`select count(*)::int as n from pg_constraint where conname = 'products_org_slug_key'`))[0].n === 1);
  ok("4.6 renamed product updated_at preserved (touch trigger disabled for backfill)",
    String((await q(`select updated_at from aura.products where id = $1`, [pB]))[0].updated_at) === String(beforeUpdate));
  ok("4.7 rename audited with created_by fallback actor",
    (await q(`select count(*)::int as n from aura.audit_events where entity_id = $1 and action = 'product.updated' and detail->'fields' @> '["slug"]'::jsonb`, [pB]))[0].n >= 1);
  await expectError("4.8 new product cannot take an existing global slug", "duplicate key", () =>
    unit("aura_app", ids.memberA, () =>
      q(`insert into aura.products (org_id, seller_profile_id, category_id, slug, title, created_by)
         values ($1, $2, $3, 'b-runner', 'Clash Shoe', $4)`, [orgA, sellerA, sneakers, ids.memberA]))
  );
  const liveWinner = await unit("aura_public", null, () =>
    q(`select title from aura.public_products where slug = 'aurora-runner'`)
  );
  ok("4.9 live product wins slug resolution over the inert collision redirect",
    liveWinner.length === 1 && liveWinner[0].title === "Aurora Runner");
  await unit("aura_app", ids.adminP, () =>
    q(`update aura.seller_profiles set suspended_at = null where id = $1`, [sellerB])
  );
  await q(`insert into aura.slug_redirects (org_id, product_id, slug, replacement_slug, reason)
           values ($1, $2, 'legacy-b-runner', 'b-runner', 'global_collision')`, [orgB, pB2]);
  const redirectResolution = await unit("aura_public", null, () =>
    q(`select canonical_slug from aura.public_slug_redirects where slug = 'legacy-b-runner'`)
  );
  ok("4.10 free legacy slug resolves to the canonical published slug (no ids exposed)",
    redirectResolution.length === 1 && redirectResolution[0].canonical_slug === "b-runner");
  await q(`delete from aura.slug_redirects where slug = 'legacy-b-runner'`);
  const suspRedirect = await unit("aura_public", null, () =>
    q(`select count(*)::int as n from aura.public_slug_redirects`)
  );
  ok("4.11 only the inert collision redirect of a published product remains publicly resolvable",
    suspRedirect[0].n === 1, `n=${suspRedirect[0].n}`);
  await exec(await readFile(path.join(proposedDir, "rollback_0009_global_product_slugs.sql"), "utf8"));
  const rolledBack = await q(`select slug from aura.products where id = $1`, [pB]);
  ok("4.12 rollback restores the original slug and removes collision redirects",
    rolledBack[0].slug === "aurora-runner" &&
    (await q(`select count(*)::int as n from aura.slug_redirects where reason = 'global_collision'`))[0].n === 0 &&
    (await q(`select count(*)::int as n from pg_indexes where schemaname = 'aura' and indexname = 'products_slug_global_key'`))[0].n === 0);
  await exec(await readFile(path.join(proposedDir, "0009_global_product_slugs.sql"), "utf8"));
  ok("4.13 re-apply after rollback is deterministic",
    (await q(`select slug from aura.products where id = $1`, [pB]))[0].slug === `aurora-runner-${pB.slice(0, 8)}`);
  await exec(`alter table aura.products disable trigger products_guard;
              alter table aura.products disable trigger products_catalogue_suspension;
              update aura.products set slug = 'drifted-slug' where id = '${pB}';
              alter table aura.products enable trigger products_guard;
              alter table aura.products enable trigger products_catalogue_suspension;`);
  const rollbackSql = await readFile(path.join(proposedDir, "rollback_0009_global_product_slugs.sql"), "utf8");
  await expectError("4.14 rollback aborts on post-migration slug drift", "slug_redirect_rollback_conflict", () =>
    exec(rollbackSql)
  );
  await exec(`alter table aura.products disable trigger products_guard;
              alter table aura.products disable trigger products_catalogue_suspension;
              update aura.products set slug = 'aurora-runner-${pB.slice(0, 8)}' where id = '${pB}';
              alter table aura.products enable trigger products_guard;
              alter table aura.products enable trigger products_catalogue_suspension;`);

  // == Group 5: rate-limit isolation ===========================================
  const hits1 = await unit("aura_public", null, () =>
    q(`insert into aura.public_rate_limits (bucket, window_start, hits)
       values ('sf:probe', to_timestamp(floor(extract(epoch from now()) / 60) * 60), 1)
       on conflict (bucket, window_start) do update set hits = aura.public_rate_limits.hits + 1
       returning hits`)
  );
  const hits2 = await unit("aura_public", null, () =>
    q(`insert into aura.public_rate_limits (bucket, window_start, hits)
       values ('sf:probe', to_timestamp(floor(extract(epoch from now()) / 60) * 60), 1)
       on conflict (bucket, window_start) do update set hits = aura.public_rate_limits.hits + 1
       returning hits`)
  );
  ok("5.1 public limiter upsert increments per window", hits1[0].hits === 1 && hits2[0].hits === 2);
  await expectError("5.2 public role cannot touch auth rate limits", "permission denied", () =>
    unit("aura_public", null, () =>
      q(`insert into aura.auth_rate_limits (bucket, window_start, hits) values ('x', now(), 1)`))
  );
  await expectError("5.3 app role cannot touch public rate limits (two-way isolation)", "permission denied", () =>
    unit("aura_app", ids.adminP, () =>
      q(`insert into aura.public_rate_limits (bucket, window_start, hits) values ('x', now(), 1)`))
  );

  // == Group 6: replay safety ==================================================
  const db2 = new PGlite();
  await db2.waitReady;
  for (const file of files)
    await db2.exec(await readFile(path.join(migrationsDir, file), "utf8"));
  await db2.exec(await readFile(path.join(proposedDir, "0008_public_storefront.sql"), "utf8"));
  await db2.exec(await readFile(path.join(proposedDir, "0009_global_product_slugs.sql"), "utf8"));
  await db2.exec(await readFile(path.join(proposedDir, "0008_public_storefront.sql"), "utf8"));
  await db2.exec(await readFile(path.join(proposedDir, "0009_global_product_slugs.sql"), "utf8"));
  ok("6.1 proposed migrations replay twice on a fresh engine without error", true);
  const v2 = (await db2.query("select version() as v")).rows as any[];
  ok("6.2 engine recorded for the evidence log", String(v2[0].v).includes("PostgreSQL"), String(v2[0].v));
  await db2.close();
  await db.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("Failures:", failures.join("; "));
    process.exit(1);
  }
}

main().catch(error => {
  console.error("VALIDATION CRASH:", error);
  process.exit(1);
});
