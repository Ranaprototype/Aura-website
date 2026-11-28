/**
 * Migration evidence for Phase 2. Applies the real migration files to a fresh
 * embedded PostgreSQL twice (proving replay safety), then inspects the resulting
 * catalogue: RLS coverage, the runtime role's attributes and privileges, the
 * function security posture, and the absence of grants to public roles.
 *
 * This inspects the migrations as shipped. It is not evidence about any deployed
 * Supabase project.
 */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const directory = fileURLToPath(
  new URL("../supabase/migrations", import.meta.url)
);
let engine: PGlite;
let files: string[];

beforeAll(async () => {
  engine = new PGlite();
  await engine.waitReady;
  files = (await readdir(directory))
    .filter(file => file.endsWith(".sql"))
    .sort();
  for (const file of files)
    await engine.exec(await readFile(path.join(directory, file), "utf8"));
  // Replaying every migration must be safe: they are written additively.
  for (const file of files)
    await engine.exec(await readFile(path.join(directory, file), "utf8"));
}, 60_000);

afterAll(async () => {
  await engine.close();
});

describe("migration set", () => {
  it("ships the identity, email, privilege and catalogue migrations after the baseline", () => {
    expect(files).toEqual([
      "0001_hello.sql",
      "0002_identity.sql",
      "0003_email.sql",
      "0004_roles.sql",
      "0005_seller_catalog.sql",
      "0006_catalog_privileges.sql",
      "0007_review_separation.sql",
      "0008_public_storefront.sql",
      "0009_global_product_slugs.sql",
    ]);
  });

  it("keeps the Phase 0 table untouched and creates the private schema", async () => {
    const tables = await engine.query<{
      table_name: string;
      table_schema: string;
    }>(
      `select table_name, table_schema from information_schema.tables
        where table_schema in ('public','aura') order by table_schema, table_name`
    );
    const names = tables.rows.map(
      row => `${row.table_schema}.${row.table_name}`
    );
    expect(names).toContain("public.hello");
    for (const table of [
      "aura.principals",
      "aura.credentials",
      "aura.sessions",
      "aura.auth_tokens",
      "aura.organizations",
      "aura.memberships",
      "aura.invitations",
      "aura.projects",
      "aura.platform_admins",
      "aura.email_events",
      "aura.email_rate_limits",
      "aura.auth_rate_limits",
      "aura.seller_profiles",
      "aura.categories",
      "aura.category_attributes",
      "aura.products",
      "aura.product_revisions",
      "aura.product_variants",
      "aura.product_media",
      "aura.product_attribute_values",
      "aura.audit_events",
    ])
      expect(names, table).toContain(table);
    // Nothing new is exposed in the PostgREST-visible public schema.
    expect(names.filter(name => name.startsWith("public."))).toEqual([
      "public.hello",
    ]);
  });

  it("enables row level security on every tenant table", async () => {
    const rows = await engine.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'aura' and c.relkind = 'r'`
    );
    const byName = Object.fromEntries(
      rows.rows.map(row => [row.relname, row.relrowsecurity])
    );
    for (const table of [
      "organizations",
      "memberships",
      "invitations",
      "projects",
      "seller_profiles",
      "products",
      "product_revisions",
      "product_variants",
      "product_media",
      "product_attribute_values",
      "audit_events",
      "categories",
      "category_attributes",
    ])
      expect(byName[table], table).toBe(true);
  });

  it("defines policies for each tenant table instead of relying on grants", async () => {
    const policies = await engine.query<{
      tablename: string;
      policyname: string;
    }>(
      `select tablename, policyname from pg_policies where schemaname = 'aura'`
    );
    const byTable = (table: string) =>
      policies.rows
        .filter(row => row.tablename === table)
        .map(row => row.policyname);
    expect(byTable("projects").sort()).toEqual([
      "projects_admin_delete",
      "projects_member_select",
      "projects_writer_insert",
      "projects_writer_update",
    ]);
    expect(byTable("memberships")).toEqual(["memberships_self_select"]);
    expect(byTable("invitations").sort()).toEqual([
      "invitations_staff_insert",
      "invitations_staff_select",
      "invitations_staff_update",
    ]);
    // Phase 3: default-deny policies plus the explicit platform-admin paths.
    expect(byTable("products").sort()).toEqual([
      "products_admin_update",
      "products_member_select",
      "products_public_select",
      "products_writer_insert",
      "products_writer_update",
    ]);
    expect(byTable("seller_profiles").sort()).toEqual([
      "seller_profiles_admin_update",
      "seller_profiles_member_select",
      "seller_profiles_public_select",
      "seller_profiles_staff_insert",
      "seller_profiles_staff_update",
    ]);
    expect(byTable("audit_events").sort()).toEqual([
      "audit_events_actor_insert",
      "audit_events_member_select",
    ]);
    expect(byTable("categories")).toEqual(["categories_read"]);
    expect(byTable("organizations")).toContain(
      "organizations_platform_admin_select"
    );
    // Revisions may only be decided by a platform administrator.
    expect(byTable("product_revisions").sort()).toEqual([
      "product_revisions_admin_update",
      "product_revisions_member_select",
      "product_revisions_writer_insert",
    ]);
  });

  it("installs the four-eyes review separation triggers", async () => {
    const triggers = await engine.query<{ tgname: string }>(
      `select t.tgname from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'aura' and not t.tgisinternal
          and t.tgname like '%review_separation'
        order by t.tgname`
    );
    expect(triggers.rows.map(row => row.tgname)).toEqual([
      "product_revisions_review_separation",
      "products_review_separation",
      "seller_profiles_review_separation",
    ]);
    const fn = await engine.query<{ n: number }>(
      `select count(*)::int as n from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'aura' and p.proname = 'review_separation_guard'`
    );
    expect(fn.rows[0]?.n).toBe(1);
  });

  it("creates a non-owner runtime role without bypass attributes", async () => {
    const role = await engine.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `select rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole
         from pg_roles where rolname = 'aura_app'`
    );
    expect(role.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });

    const owned = await engine.query<{ count: number }>(
      `select count(*)::int as count from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'aura'
          and pg_get_userbyid(c.relowner) = 'aura_app'`
    );
    expect(owned.rows[0]?.count).toBe(0);
  });

  it("does not grant direct membership or organization writes to the runtime", async () => {
    const privileges = await engine.query<{
      table_name: string;
      privilege_type: string;
      grantee: string;
    }>(
      `select table_name, privilege_type, grantee
         from information_schema.role_table_grants
        where table_schema = 'aura' and grantee = 'aura_app'`
    );
    const forTable = (table: string) =>
      privileges.rows
        .filter(row => row.table_name === table)
        .map(row => row.privilege_type)
        .sort();
    expect(forTable("organizations")).toEqual(["SELECT"]);
    expect(forTable("memberships")).toEqual(["SELECT"]);
    expect(forTable("projects")).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);

    // Phase 3: catalogue rows are archived, never deleted; reference data is
    // read-only; the audit trail cannot be updated or removed by the runtime.
    expect(forTable("products")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    // Phase 4 (0008): table-level SELECT on seller_profiles is revoked and
    // replaced with a column allowlist that EXCLUDES the confidential
    // suspension_note. Only INSERT/UPDATE remain as table grants.
    expect(forTable("seller_profiles")).toEqual(["INSERT", "UPDATE"]);
    expect(forTable("categories")).toEqual(["SELECT"]);
    expect(forTable("category_attributes")).toEqual(["SELECT"]);
    expect(forTable("audit_events")).toEqual(["INSERT", "SELECT"]);
    expect(forTable("product_revisions")).toEqual([
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
  });

  it("keeps the Phase 3 privilege evaluator and snapshot builder private", async () => {
    const rows = await engine.query<{
      name: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      public_execute: boolean;
      app_execute: boolean;
    }>(
      `select p.proname as name, p.prosecdef, p.proconfig,
              has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
              has_function_privilege('aura_app', p.oid, 'EXECUTE') as app_execute
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'aura' and p.proname in ('is_platform_admin', 'build_product_snapshot')
        order by p.proname`
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.prosecdef, row.name).toBe(true);
      expect(row.public_execute, row.name).toBe(false);
      expect(row.app_execute, row.name).toBe(true);
      expect(row.proconfig, row.name).toContain("search_path=pg_catalog, aura");
    }
  });

  it("revokes PUBLIC execute on the security definer functions", async () => {
    const functions = await engine.query<{
      name: string;
      prosecdef: boolean;
      proconfig: string[] | null;
      public_execute: boolean;
      app_execute: boolean;
    }>(
      `select p.proname as name, p.prosecdef,
              p.proconfig,
              has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
              has_function_privilege('aura_app', p.oid, 'EXECUTE') as app_execute
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'aura' and p.proname in (
          'create_organization','set_member_role','revoke_membership',
          'accept_invitation','org_members','is_active_member'
        )
        order by p.proname`
    );
    expect(functions.rows).toHaveLength(6);
    for (const row of functions.rows) {
      expect(row.prosecdef, row.name).toBe(true);
      expect(row.public_execute, row.name).toBe(false);
      expect(row.app_execute, row.name).toBe(true);
      expect(row.proconfig, row.name).toContain("search_path=pg_catalog, aura");
    }
  });

  it("grants no privileges on the private schema to PUBLIC", async () => {
    const usage = await engine.query<{ has: boolean }>(
      `select has_schema_privilege('public', 'aura', 'USAGE') as has`
    );
    expect(usage.rows[0]?.has).toBe(false);
    const publicGrants = await engine.query<{
      table_name: string;
      privilege_type: string;
    }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'aura' and grantee = 'PUBLIC'`
    );
    expect(publicGrants.rows).toEqual([]);
  });
});

describe("Phase 4 public storefront posture", () => {
  it("creates a non-login, non-bypass catalog owner that owns the definer views", async () => {
    const role = await engine.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      `select rolsuper, rolbypassrls, rolcanlogin
         from pg_roles where rolname = 'aura_catalog_owner'`
    );
    expect(role.rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: false,
    });
    const views = await engine.query<{ viewname: string; owner: string }>(
      `select viewname, viewowner as owner from pg_views
        where schemaname = 'aura' and viewname like 'public_%'
        order by viewname`
    );
    expect(views.rows.map(row => row.viewname)).toEqual([
      "public_product_attributes",
      "public_product_media",
      "public_product_variants",
      "public_products",
      "public_slug_redirects",
    ]);
    for (const row of views.rows)
      expect(row.owner, row.viewname).toBe("aura_catalog_owner");
  });

  it("gives aura_public zero base-table grants; only views and the limiter table", async () => {
    const base = await engine.query<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
        where table_schema = 'aura' and grantee = 'aura_public'
          and table_name not in (
            'public_products','public_product_variants','public_product_media',
            'public_product_attributes','public_slug_redirects','public_rate_limits'
          )`
    );
    expect(base.rows).toEqual([]);
    // The anonymous role can read the discovery views but never the base tables.
    const direct = await engine.query<{ has: boolean }>(
      `select has_table_privilege('aura_public', 'aura.products', 'SELECT') as has`
    );
    expect(direct.rows[0]?.has).toBe(false);
    const viaView = await engine.query<{ has: boolean }>(
      `select has_table_privilege('aura_public', 'aura.public_products', 'SELECT') as has`
    );
    expect(viaView.rows[0]?.has).toBe(true);
  });

  it("excludes the confidential suspension_note from the runtime column allowlist", async () => {
    const cols = await engine.query<{ column_name: string }>(
      `select column_name from information_schema.role_column_grants
        where table_schema = 'aura' and table_name = 'seller_profiles'
          and grantee = 'aura_app' and privilege_type = 'SELECT'
        order by column_name`
    );
    const names = cols.rows.map(row => row.column_name);
    expect(names).toContain("suspended_at");
    expect(names).toContain("suspended_by");
    expect(names).not.toContain("suspension_note");
    // The note is reachable only through the restricted SECURITY DEFINER accessor.
    const fn = await engine.query<{ prosecdef: boolean; app_execute: boolean; public_execute: boolean }>(
      `select p.prosecdef,
              has_function_privilege('aura_app', p.oid, 'EXECUTE') as app_execute,
              has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'aura' and p.proname = 'seller_suspension_note'`
    );
    expect(fn.rows[0]?.prosecdef).toBe(true);
    expect(fn.rows[0]?.app_execute).toBe(true);
    expect(fn.rows[0]?.public_execute).toBe(false);
  });

  it("enforces global product slug uniqueness and keeps the public limiter isolated", async () => {
    // 0009 adds a global UNIQUE INDEX on slug; the original per-organization
    // constraint is retained (the reviewed rollback relies on it).
    const indexes = await engine.query<{ indexname: string; indisunique: boolean }>(
      `select i.relname as indexname, ix.indisunique
         from pg_index ix
         join pg_class i on i.oid = ix.indexrelid
        where ix.indrelid = 'aura.products'::regclass
          and i.relname = 'products_slug_global_key'`
    );
    expect(indexes.rows[0]?.indisunique).toBe(true);
    const constraints = await engine.query<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'aura.products'::regclass and contype = 'u'
        order by conname`
    );
    const names = constraints.rows.map(row => row.conname);
    expect(names).toContain("products_org_slug_key");
    // The public limiter is a separate table from the auth limiter.
    const tables = await engine.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'aura'
          and table_name in ('public_rate_limits','auth_rate_limits')
        order by table_name`
    );
    expect(tables.rows.map(row => row.table_name)).toEqual([
      "auth_rate_limits",
      "public_rate_limits",
    ]);
  });
});
