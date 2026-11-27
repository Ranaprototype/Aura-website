# AURA Phase 4 — Database Ownership and Migration Prerequisites

Review-only. This document defines the exact deployment prerequisite procedure for `0008_public_storefront.sql` and related validation. It does not apply migrations.

## 1. Role creation

Create `aura_catalog_owner` as a non-superuser, no-bypass-RLS role:

- `NOSUPERUSER`
- `NOBYPASSRLS`
- `NOLOGIN` or dedicated migration login as appropriate
- Ownership of relevant base tables and sequences

## 2. Required ownership

- `aura_catalog_owner` must own the public catalogue base tables, sequences, and functions referenced by discovery views.
- Migration executor must have privileges to create/alter objects in the target schema.

## 3. Migration executor privileges

- Membership in roles needed to execute migrations.
- `USAGE` and `CREATE` on target schema.
- Ability to alter owned objects and policies.

## 4. SECURITY DEFINER views

- Discovery views must be owned by `aura_catalog_owner`.
- `search_path` must be explicitly set.
- View definitions must not expose internal ids or seller identity.

## 5. Verification

Verify:

- `NOSUPERUSER` and `NOBYPASSRLS`.
- Correct ownership of tables, sequences, functions, views.
- Default privileges and future migration behavior.
- Rollback considerations for `0009`.

## 6. Disposable vs deployment

Disposable PGlite validation proves SQL semantics only. Real Supabase/PostgreSQL grants, PostgREST exposure, and ownership must be verified in the target environment before implementation.
