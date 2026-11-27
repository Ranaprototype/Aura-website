# AURA Phase 4 — Database Ownership and Migration Prerequisites (summary)

Review-only. **This is a quick-reference summary.** The authoritative, exact, executable deployment runbook — with full SQL, verification queries and rollback — is **[AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md)**. This document does not apply migrations. D-22 remains OPEN.

## 1. Role creation
Create `aura_catalog_owner` as **NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB**. It is an object-owner group role, never a login. (The *migration executor* is a separate login — see §3.) Exact SQL: procedure §2.

## 2. Required ownership
`aura_catalog_owner` owns schema `aura` + the seven catalog base tables (`products`, `seller_profiles`, `product_variants`, `product_media`, `product_attribute_values`, `categories`, `category_attributes`) and their owned sequences. `slug_redirects` is created by 0008 and reassigned to the catalog owner in 0008 §8. Identity/audit tables are **not** transferred. Exact SQL: procedure §3.

## 3. Migration executor privileges
The executor needs `CREATEROLE` (0008 creates `aura_public`) and **membership in `aura_catalog_owner`** (to reassign ownership in 0008 §8 and to read catalog rows via the owner RLS exemption). `NOSUPERUSER NOBYPASSRLS` recommended. If it is a dedicated non-superuser role that does not own the helper functions, grant it `EXECUTE` on `aura.is_active_member(uuid,text[])` and `aura.is_platform_admin()` so the suspension-note accessor works. Exact SQL + rationale: procedure §4.

## 4. SECURITY DEFINER views
The five public discovery views are owned by `aura_catalog_owner` (0008 §8) and are SECURITY DEFINER (no `security_invoker`). They read base rows via **table ownership** (owner RLS exemption; tables use ENABLE not FORCE), never via a privileged login or a grant to `aura_public`. The definer function pins `search_path = pg_catalog, aura`. Views expose no internal ids or seller identity. Verification: procedure §7.

## 5. Verification
Catalog assertions (procedure §7, proven by validation 1.16–1.24): owner NOSUPERUSER/NOBYPASSRLS/NOLOGIN; correct ownership of tables + views; definer security mode; effective grants (`aura_public` SELECT on the five views only, zero base grants); member-executor reassignment allowed / non-member denied; member-of-owner RLS bypass; note-accessor helper EXECUTE; public login view-only.

## 6. Disposable vs deployment
Disposable PGlite validation proves SQL/RLS/ownership semantics only. Real PostgreSQL/Supabase grants, PostgREST exposure and ownership must be re-verified on the target (owner gate G1) before implementation. Rollback considerations: procedure §9.
