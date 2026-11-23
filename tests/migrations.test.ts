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

const directory = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
let engine: PGlite;
let files: string[];

beforeAll(async () => {
  engine = new PGlite();
  await engine.waitReady;
  files = (await readdir(directory)).filter(file => file.endsWith(".sql")).sort();
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
  it("ships the identity, email and privilege migrations after the baseline", () => {
    expect(files).toEqual([
      "0001_hello.sql",
      "0002_identity.sql",
      "0003_email.sql",
      "0004_roles.sql",
    ]);
  });

  it("keeps the Phase 0 table untouched and creates the private schema", async () => {
    const tables = await engine.query<{ table_name: string; table_schema: string }>(
      `select table_name, table_schema from information_schema.tables
        where table_schema in ('public','aura') order by table_schema, table_name`
    );
    const names = tables.rows.map(row => `${row.table_schema}.${row.table_name}`);
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
    ])
      expect(names, table).toContain(table);
    // Nothing new is exposed in the PostgREST-visible public schema.
    expect(names.filter(name => name.startsWith("public."))).toEqual(["public.hello"]);
  });

  it("enables row level security on every tenant table", async () => {
    const rows = await engine.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'aura' and c.relkind = 'r'`
    );
    const byName = Object.fromEntries(rows.rows.map(row => [row.relname, row.relrowsecurity]));
    for (const table of ["organizations", "memberships", "invitations", "projects"])
      expect(byName[table], table).toBe(true);
  });

  it("defines policies for each tenant table instead of relying on grants", async () => {
    const policies = await engine.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies where schemaname = 'aura'`
    );
    const byTable = (table: string) =>
      policies.rows.filter(row => row.tablename === table).map(row => row.policyname);
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
    expect(forTable("projects")).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
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
    const publicGrants = await engine.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'aura' and grantee = 'PUBLIC'`
    );
    expect(publicGrants.rows).toEqual([]);
  });
});
