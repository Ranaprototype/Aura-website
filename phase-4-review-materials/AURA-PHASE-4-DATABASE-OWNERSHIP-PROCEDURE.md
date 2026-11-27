# AURA Phase 4 — Database Ownership & Migration Prerequisites Procedure

**Status:** deployment runbook for review · **NOT executed against any real database** · part of the Phase 4 review-only package.
**Audience:** the operator/DBA who will run the Phase 4 migrations **after** the owner grants D-22.
**Companion documents:** [AURA-PHASE-4-PLAN.md](AURA-PHASE-4-PLAN.md) (§4.3, §6) · [AURA-MASTER-SPECIFICATION.md](AURA-MASTER-SPECIFICATION.md) (§19 register) · proposed SQL in [`validation/phase-4/proposed/`](validation/phase-4/proposed/).
**Baseline:** `master` = `b12a5596bf3b454b844c5d3b5bc83784247e300f` (Phases 0–3). Engine target: PostgreSQL ≥ 15 (validated on PGlite 0.5.16 / PostgreSQL 18.6).

> **Why this document exists.** Phase 4 exposes the catalogue to an anonymous role (`aura_public`) through **SECURITY DEFINER views**. A definer view reads base tables with the privileges of its **owner**. For that to be a safe boundary, the owner must be a **non-superuser, NOBYPASSRLS** role that **owns the base tables** — so the views reach rows via *table ownership* (the owner RLS exemption), never via a privileged login and never via a grant to the public role. This runbook makes that ownership explicit, ordered, verifiable and reversible. It is the prerequisite the owner asked to be documented before any go/no-go decision. **D-22 remains OPEN; nothing here authorizes implementation.**

---

## 0. Role model (target state)

| Role | Kind | Attributes | Purpose |
| --- | --- | --- | --- |
| `aura_catalog_owner` | group, **NOLOGIN** | `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB` | Owns schema `aura` + the catalog base tables + the five public definer views + `slug_redirects`. The **only** role whose privileges the public views borrow. |
| `aura_app` | group, **NOLOGIN** | `NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION` | Authenticated runtime (0004). RLS-scoped; never owns catalog objects. |
| `aura_public` | group, **NOLOGIN** | `NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION` | Anonymous read role (0008). **Zero base-table grants**; SELECT on the five discovery views only. |
| `aura_app_login` | **LOGIN** | default `INHERIT`, `NOSUPERUSER NOBYPASSRLS` | Request-processing login; member of `aura_app`. |
| `aura_public_login` | **LOGIN** | default `INHERIT`, `NOSUPERUSER NOBYPASSRLS` | Public-pool login; member of `aura_public`. |
| migration executor | **LOGIN** (operator) | `CREATEROLE NOSUPERUSER NOBYPASSRLS` (recommended) | Runs 0008/0009. Member of `aura_catalog_owner`. **Never** used for requests. |

**Invariant:** no request-processing login (`aura_app_login`, `aura_public_login`) is superuser or BYPASSRLS, and neither owns catalog objects. The catalog owner is NOLOGIN, so it can never be used to connect.

---

## 1. Pre-flight (read-only; run before any change)

```sql
-- 1a. Engine version (must be >= 15 for security_invoker view semantics).
show server_version;

-- 1b. Current owner + attributes of every aura relation. Record this output:
--     it is the rollback target for ownership (see §9).
select c.relname, c.relkind, r.rolname as owner, r.rolsuper, r.rolbypassrls
  from pg_class c join pg_roles r on r.oid = c.relowner
 where c.relnamespace = 'aura'::regnamespace
 order by c.relkind, c.relname;

-- 1c. Confirm the runtime roles are already least-privilege (0004/0008).
select rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreaterole
  from pg_roles where rolname in ('aura_app','aura_public');

-- 1d. Confirm no FORCE ROW LEVEL SECURITY on the catalog tables (the owner
--     exemption relied on below requires ENABLE, not FORCE).
select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
 where c.relnamespace = 'aura'::regnamespace and c.relkind = 'r';
```

**Stop conditions:** any catalog table has `relforcerowsecurity = true`; any request login is superuser/BYPASSRLS; engine < 15. Resolve before continuing.

---

## 2. Create `aura_catalog_owner` (idempotent)

```sql
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aura_catalog_owner') then
    create role aura_catalog_owner
      nologin nosuperuser nobypassrls nocreaterole nocreatedb;
  end if;
end
$$;

comment on role aura_catalog_owner is
  'AURA Phase 4: non-superuser NOBYPASSRLS owner of the catalog base tables and the public SECURITY DEFINER discovery views. NOLOGIN; never a request role.';
```

**Required attributes, and why each matters:**
- `NOSUPERUSER` — a superuser owner would bypass *every* control, making the definer boundary meaningless.
- `NOBYPASSRLS` — the owner must reach rows via the **owner RLS exemption**, not a blanket RLS bypass attribute.
- `NOLOGIN` — the role can never be used to connect; it exists only to own objects.
- `NOCREATEROLE NOCREATEDB` — no privilege-escalation surface.
- `INHERIT` is left at its default; it is not security-relevant for a NOLOGIN object owner.

**Verify immediately:**
```sql
select rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
  from pg_roles where rolname = 'aura_catalog_owner';
-- expected: f, f, f, f, f
```

---

## 3. Transfer base-table + schema ownership

The seven catalog base tables that the public views read (plus the schema) move to `aura_catalog_owner`. `slug_redirects` is created later by 0008 and reassigned in 0008 §8, so it is **not** listed here.

```sql
alter schema aura owner to aura_catalog_owner;

alter table aura.products               owner to aura_catalog_owner;
alter table aura.seller_profiles        owner to aura_catalog_owner;
alter table aura.product_variants       owner to aura_catalog_owner;
alter table aura.product_media          owner to aura_catalog_owner;
alter table aura.product_attribute_values owner to aura_catalog_owner;
alter table aura.categories             owner to aura_catalog_owner;
alter table aura.category_attributes    owner to aura_catalog_owner;
```

Notes:
- `ALTER TABLE … OWNER` also moves **owned sequences** and the table's RLS policies stay attached; grants to `aura_app` (0004/0006) are preserved.
- Identity/audit tables (`principals`, `credentials`, `sessions`, `memberships`, `organizations`, `audit_events`, …) are **not** transferred — the public views never read them, and they keep their existing owner.
- This step is idempotent (re-running `ALTER … OWNER` to the same role is a no-op).

**Verify:**
```sql
select c.relname, r.rolname as owner
  from pg_class c join pg_roles r on r.oid = c.relowner
 where c.relnamespace = 'aura'::regnamespace
   and c.relname in ('products','seller_profiles','product_variants','product_media',
                     'product_attribute_values','categories','category_attributes');
-- expected: 7 rows, owner = aura_catalog_owner
```

---

## 4. Migration executor: privileges + role membership

0008 creates the `aura_public` role (needs `CREATEROLE`) and reassigns view ownership to `aura_catalog_owner` (needs **membership** in that role). The executor is an operator role, never a request login.

```sql
-- Example dedicated executor (or use the original deployer role / a superuser).
create role aura_migrator login createrole nosuperuser nobypassrls nocreatedb
  password '<operator-secret>';

-- Membership lets the executor (a) reassign ownership to the catalog owner in
-- 0008 §8 and (b) read catalog tables through the owner RLS exemption.
grant aura_catalog_owner to aura_migrator;
```

**Executor privilege requirements (exact):**
1. `CREATEROLE` — 0008 creates `aura_public`.
2. **Member of `aura_catalog_owner`** — required to `ALTER … OWNER TO aura_catalog_owner` in 0008 §8. *Proven:* a non-member executor is denied the reassignment; a member succeeds (validation 1.20/1.21).
3. `NOSUPERUSER NOBYPASSRLS` recommended. A superuser executor also works (it bypasses the membership check) but is **not** required and is discouraged for routine migrations.
4. **Helper EXECUTE for the suspension-note accessor.** `aura.seller_suspension_note(uuid)` is SECURITY DEFINER and calls `aura.is_active_member(uuid,text[])` and `aura.is_platform_admin()`. Those helpers are executable only by their owner and `aura_app` (ACL `{owner=X, aura_app=X}`; **not PUBLIC**). The note function is owned by the **executor**, so the executor must be able to execute the helpers:
   - If the executor **is the original deployer** (it owns the helpers) or a **superuser**, it already can — no extra grant.
   - If the executor is a **dedicated non-superuser role** that does not own the helpers, grant them explicitly (by the helper owner / superuser):
     ```sql
     grant execute on function aura.is_active_member(uuid, text[]) to aura_migrator;
     grant execute on function aura.is_platform_admin()            to aura_migrator;
     ```
   *Proven:* the catalog owner cannot execute the helpers without a grant, and can after it (validation 1.23). The public role `aura_public` is **never** granted these helpers (membership-oracle risk, D-02).

**Why membership is safe:** PostgreSQL exempts a table's **owner** from that table's RLS unless `FORCE ROW LEVEL SECURITY` is set; a role that is a **member of the owner** inherits that exemption. The aura catalog tables use `ENABLE` (not `FORCE`), so the executor-member reads catalog rows for the migration backfill without any grant to `aura_public`. *Proven:* a non-superuser member of the owner reads rows through a `using(false)` policy; a non-member does not (validation 1.22).

---

## 5. Run the migrations (order matters)

Run as the executor from §4, each in **one transaction**:

1. **`0008_public_storefront.sql`** — suspension overlay + guards; confidential-note accessor; creates `aura_public`; scopes helper-calling policies `TO aura_app`; creates the five **SECURITY DEFINER** discovery views; `public_rate_limits`; `slug_redirects`; function EXECUTE hygiene. **§8** then reassigns the five views **and** `slug_redirects` to the owner of `aura.products` (i.e. `aura_catalog_owner` from §3). The invoker view `storefront_products` is **not** reassigned (it is the `aura_app` projection).
2. **`0009_global_product_slugs.sql`** — deterministic cross-org slug dedupe + global unique index (disables only the two user triggers for the backfill; audit trigger stays active).

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f 0008_public_storefront.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f 0009_global_product_slugs.sql
```

**Do not** edit `0001`–`0007`. 0008 forward-replaces two Phase 3 functions and the `storefront_products` view via `CREATE OR REPLACE` (normal forward migration; non-suspended behaviour unchanged).

---

## 6. Provision request logins (out of band, production)

```sql
create role aura_app_login    login password '<secret>';  grant aura_app    to aura_app_login;
create role aura_public_login login password '<secret>';  grant aura_public to aura_public_login;
-- DATABASE_URL=postgres://aura_app_login:…@host/db?sslmode=require
-- DATABASE_PUBLIC_URL=postgres://aura_public_login:…@host/db?sslmode=require
```

Logins keep default `INHERIT` so they inherit the group grants and match `TO group` policies (validated 1.10). **Never** use `postgres`/service-role for requests. The public login inherits `aura_public`'s view-only SELECT and **no** base-table access (validated 1.24).

---

## 7. SECURITY DEFINER ownership verification (deployment gate G1)

Run after 0008/0009. These are the **exact** catalog assertions proven in validation (1.16–1.19) plus the executor/RLS/helper proofs (1.20–1.24). All must pass before the public surface is enabled.

```sql
-- 7a. The five public views are owned by the catalog owner (not a privileged role).
select c.relname, r.rolname as owner
  from pg_class c join pg_roles r on r.oid = c.relowner
 where c.relnamespace = 'aura'::regnamespace
   and c.relname in ('public_products','public_product_variants','public_product_media',
                     'public_product_attributes','public_slug_redirects');
-- expected: 5 rows, owner = aura_catalog_owner

-- 7b. Catalog owner attributes: NOSUPERUSER, NOBYPASSRLS, NOLOGIN.
select rolcanlogin, rolsuper, rolbypassrls
  from pg_roles where rolname = 'aura_catalog_owner';
-- expected: f, f, f

-- 7c. Catalog owner owns every base table the views read (8 incl. slug_redirects).
select count(*) as owned
  from pg_class c join pg_roles r on r.oid = c.relowner
 where c.relnamespace = 'aura'::regnamespace
   and c.relname in ('products','seller_profiles','product_variants','product_media',
                     'product_attribute_values','categories','category_attributes','slug_redirects')
   and r.rolname = 'aura_catalog_owner';
-- expected: 8

-- 7d. The five public views are SECURITY DEFINER (no security_invoker reloption).
select c.relname, coalesce(c.reloptions::text,'') as reloptions
  from pg_class c
 where c.relnamespace = 'aura'::regnamespace
   and c.relname in ('public_products','public_product_variants','public_product_media',
                     'public_product_attributes','public_slug_redirects');
-- expected: no 'security_invoker=true' on any row

-- 7e. Effective grants: aura_public SELECT on the five views ONLY; zero base SELECT.
select has_table_privilege('aura_public','aura.public_products','SELECT')          as v_products,
       has_table_privilege('aura_public','aura.public_product_variants','SELECT')  as v_variants,
       has_table_privilege('aura_public','aura.public_product_media','SELECT')     as v_media,
       has_table_privilege('aura_public','aura.public_product_attributes','SELECT')as v_attrs,
       has_table_privilege('aura_public','aura.public_slug_redirects','SELECT')    as v_redirects,
       has_table_privilege('aura_public','aura.products','SELECT')                 as base_products,
       has_table_privilege('aura_public','aura.seller_profiles','SELECT')          as base_sellers;
-- expected: v_* = t, base_* = f

-- 7f. No request login is superuser/BYPASSRLS; catalog owner is NOLOGIN.
select rolname, rolcanlogin, rolsuper, rolbypassrls
  from pg_roles where rolname in ('aura_app_login','aura_public_login','aura_catalog_owner');
-- expected: logins t/f/f; catalog_owner f/f/f

-- 7g. Negative direct-SQL test as the public login (must be denied on base tables).
--     Run connected as aura_public_login:
--       select * from aura.products;        -- expect: permission denied
--       select * from aura.public_products; -- expect: published rows only
```

**Gate:** if any assertion fails, **do not enable** `DATABASE_PUBLIC_URL`; fix ownership/grants and re-run. This is the target-side verification the plan (§6.4) requires and the owner gate G1.

---

## 8. Grants, default privileges, migration order (summary)

**Grants actually applied (all explicit; nothing relies on PUBLIC defaults):**
- `aura_public`: `USAGE` on schema `aura`; `SELECT` on the five discovery views; `SELECT/INSERT/UPDATE/DELETE` on `public_rate_limits` (isolated limiter). **Zero** base-table grants, **zero** function EXECUTE.
- `aura_app`: unchanged 0004/0006 grants; 0008 narrows `seller_profiles` to a **column list excluding `suspension_note`**; adds EXECUTE on `seller_suspension_note` + the suspension guards.
- Helper functions (`is_active_member`, `is_platform_admin`, `current_principal`): executable by owner + `aura_app` only; **never** `aura_public`.

**Default privileges:** PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function by default. 0006 and 0008 §6 **revoke** that on the functions they create and grant only to the runtime role that fires them. Tables get no PUBLIC grant by default; 0006/0008 still `REVOKE ALL … FROM public` explicitly as defense-in-depth. **No `ALTER DEFAULT PRIVILEGES` is used** — every grant is explicit and auditable, so a future object never silently inherits a public grant. (If the operator later adds `ALTER DEFAULT PRIVILEGES`, re-run §7e/§7g.)

**Migration order (single source of truth):**
```
0001–0007 (already applied) 
  → §2 create aura_catalog_owner
  → §3 transfer schema + 7 base tables
  → §4 executor CREATEROLE + membership (+ helper EXECUTE if dedicated)
  → 0008 (creates aura_public, views; §8 reassigns views + slug_redirects to catalog owner)
  → 0009 (global slugs)
  → §6 provision logins
  → §7 verification gate G1
```

---

## 9. Rollback considerations

**0009 (global slugs):** a reviewed rollback is provided and validated — [`rollback_0009_global_product_slugs.sql`](validation/phase-4/proposed/rollback_0009_global_product_slugs.sql). It restores the pre-migration per-org slug state, removes **only** migration-created `global_collision` redirects, and **aborts on drift** (if a renamed slug changed since migration). Restoring duplicates is legal because the per-org unique constraint was the original invariant.

**0008 (storefront):** no destructive down-migration is shipped. If reversal is ever required it is a **reviewed forward-fix**: drop the five public views + `public_slug_redirects`, revoke `aura_public` grants, drop `aura_public`/`public_rate_limits`, and drop the suspension policies/guards. **Retain** the suspension columns (`suspended_at`, `suspended_by`, `suspension_note`) until a reviewed removal — dropping them loses the audit trail. The `storefront_products` invoker view and the two forward-replaced functions revert to their Phase 3 definitions via `CREATE OR REPLACE`.

**Ownership reversal (this procedure):** to undo §2–§3, reassign the schema + tables back to the **recorded pre-flight owner** (§1b output), then drop the role. A role that owns objects cannot be dropped directly:
```sql
-- Reassign owned objects back to the original owner first (example: postgres).
reassign owned by aura_catalog_owner to postgres;   -- or the recorded original owner
drop owned by aura_catalog_owner;                    -- clears remaining privileges/defaults
drop role aura_catalog_owner;
```
**Order:** reverse 0009 (if applied) → reverse 0008 views/grants → reassign ownership → drop roles. Drop the **logins** (`aura_app_login`, `aura_public_login`) before their group roles; drop `aura_public` only after its grants/views are gone. **Never** drop `aura_catalog_owner` while the definer views still depend on it — reassign the views first or the public read path breaks.

**Executor membership:** revoking `aura_catalog_owner` from the executor after migration is safe for the *views* (they are owned by the catalog owner, not the executor). It only affects future migrations and the executor-owned note accessor; keep the membership (or reassign the note function) if the accessor must keep working under that executor.

---

## 10. Mapping to executed validation

| Procedure claim | Executed check(s) in `validate.ts` |
| --- | --- |
| Catalog owner created NOLOGIN/NOSUPERUSER/NOBYPASSRLS; owns 8 base tables | 1.17 |
| Five definer views owned by catalog owner | 1.16 |
| Views are SECURITY DEFINER (no `security_invoker`) | 1.18 |
| `aura_public` SELECT on views only; zero base grants | 1.19, 1.24 |
| Member executor can reassign ownership (§8 operation) | 1.20 |
| Non-member executor cannot reassign | 1.21 |
| Member of owner bypasses catalog RLS (ENABLE, not FORCE) | 1.22 |
| Note-function owner needs helper EXECUTE (grant necessary + sufficient) | 1.23 |
| Public login inherits view-only access, no base access | 1.24 |
| Defense-in-depth policies hide suspended/unapproved sellers under a simulated base grant | 2.21–2.29 |

**Evidence limit:** PGlite is single-process WASM PostgreSQL. It proves SQL/RLS/trigger/policy/ownership semantics, **not** multi-backend contention, deployed grants, or PostgREST exposure. The §7 gate must be re-run on the deployed target; that is owner gate G1, never assumed.
