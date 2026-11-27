# Phase 4 planning validation (disposable)

**Purpose:** executed evidence for [AURA-PHASE-4-PLAN.md](../../AURA-PHASE-4-PLAN.md). These artifacts are **not** application code, **not** real migrations, and are **not** wired into the app, the migration ledger (`supabase/migrations/`) or CI. They exist so the Phase 4 design is proven on a disposable engine before any implementation is authorized.

## Contents

- `proposed/0008_public_storefront.sql` — proposed additive migration: seller suspension overlay + guards, four-eyes extension (suspend **and** restore), confidential-note accessor (`aura.seller_suspension_note`), `aura_public` role with **zero base-table grants**, `ALTER POLICY … TO aura_app` scoping, role-targeted public RLS policies (defense-in-depth), **SECURITY DEFINER discovery views** (slug-keyed, no internal ids/seller fields), isolated `public_rate_limits`, `slug_redirects` + public redirect view, function EXECUTE hygiene.
- `proposed/0009_global_product_slugs.sql` — proposed additive migration: deterministic cross-org slug dedupe (trigger-safe backfill) + global unique index.
- `proposed/rollback_0009_global_product_slugs.sql` — reviewed rollback (restores originals, removes only collision redirects, aborts on drift).
- `validate.ts` — replays the real `0001`–`0007` ledger on fresh in-memory PGlite, applies the proposals, builds two-tenant fixtures through the real guarded paths, and asserts 76 checks (roles/zero-base-grants/EXECUTE/definer-view, anonymous reads + negative paths + exact API list SQL, suspension lifecycle/four-eyes/freeze/restore/note-confidentiality, slug backfill/redirects/rollback/drift, limiter isolation, double replay).
- `probe-app.ts` — 9 checks against the real Express app using the repository's disposable-DB harness: confirms the `no-store` mount-order defect on `/api/v1`, anonymous GET/CSRF compatibility, cross-site mutation refusal, uniform API 404, seller auth requirement.
- `results/` — executed logs: `sql-validation.log` (76/76), `app-probe.log` (9/9), `browser-baseline.log` (3/3, sandbox NSS workaround).

## Run

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
node --import tsx validation/phase-4/validate.ts
node --import tsx validation/phase-4/probe-app.ts
# Browser baseline (sandbox NSS workaround; see findings below):
LD_LIBRARY_PATH=/tmp/al2023/lib corepack pnpm test:browser
```

Engine: PGlite 0.5.16 / PostgreSQL 18.6 (single-process WASM). This proves SQL/RLS/trigger/policy semantics, **not** multi-backend contention, deployed grants or PostgREST exposure. No shared or production database is touched.

## Findings that changed the design

1. Public reads initially failed with `permission denied for function is_active_member`: Phase 2/3 helper-calling policies target PUBLIC (all roles). Fix: `ALTER POLICY … TO aura_app` (never grant helper EXECUTE to the public role). Check 1.12.
2. `catalogue_suspension_guard` referenced `old.status` on child tables (SQL `AND` does not guarantee short-circuit). Fix: nested IFs. Check 3.17.
3. Suspension trigger ordering: `seller_profiles_0_suspension_guard` fires first so mixed edits fail as `suspension_must_be_atomic`; four-eyes denial for dual-role admins still comes from `review_separation_guard`. Checks 3.1/3.11/3.13/3.20.
4. App probe confirmed `/api/v1` responses currently lack `Cache-Control: no-store` (middleware mounted after the v1 routers). Phase 4 reorders the mount. Probe A.3.
5. **Owner correction (2026-11-27):** public reads moved from `security_invoker` + column grants to **zero-base-grant SECURITY DEFINER discovery views** (D-02 — column grants cannot hide internal join/predicate ids), public seller storefronts removed (D-01), and the suspension note made confidential via column grant + the `aura.seller_suspension_note` accessor with redacted audit detail (D-03). Checks 1.3–1.5/1.14/1.15, 2.6–2.8, 3.5–3.10.
6. **Browser baseline in this sandbox:** plain `pnpm test:browser` cannot launch Chromium (missing NSS/NSPR). Decompress `@sparticuz/chromium` `bin/al2023.tar.br` to `/tmp/al2023` and run with `LD_LIBRARY_PATH=/tmp/al2023/lib` → 3/3. Sandbox setup only; no repository file changed. Hosted CI (`google-chrome`) remains the authoritative browser gate.
