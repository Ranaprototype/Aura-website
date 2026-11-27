# AURA Phase 4 — Review Materials (read-only)

This directory contains the **planning and validation materials only** for AURA Phase 4, published for independent owner review. It contains **no implementation changes**: no application code, no edits to the real migration ledger (`supabase/migrations/`), and no wiring into the app or CI. The proposed SQL here is a **validation artifact**, never applied to the real ledger.

- **Repository:** `Ranaprototype/Aura-website`
- **Review branch:** `arena/091f37f6-aura-website` (this session's branch name is fixed by the platform; a branch named `phase-4-review-materials` cannot be created here, so the materials live in this directory instead).
- **Base / verified master:** `b12a5596bf3b454b844c5d3b5bc83784247e300f` (PR #4 merge; unchanged).
- **Status:** prepared for review. **No PR, no merge, no deployment, no Phase 4 implementation.** Implementation awaits explicit owner approval (register D-22).

## Contents (13 deliverables)

### Specification documents
| File | Purpose |
| --- | --- |
| [`AURA-MASTER-SPECIFICATION.md`](AURA-MASTER-SPECIFICATION.md) | Product requirements + the single consolidated decision register (§19, Classes I/II/III). |
| [`AURA-COMPLETE-ROADMAP.md`](AURA-COMPLETE-ROADMAP.md) | Phase sequence, scope, dependencies, acceptance criteria. |
| [`AURA-AGENT-OPERATING-RULES.md`](AURA-AGENT-OPERATING-RULES.md) | Owner authority rule + mandatory development workflow. |
| [`AURA-PHASE-4-PLAN.md`](AURA-PHASE-4-PLAN.md) | Phase 4 technical design, API contracts, the 20 review issues, migration/deployment plan, executed vs proposed evidence. |

### Validation package (`validation/phase-4/`)
| File | Purpose |
| --- | --- |
| [`validation/phase-4/README.md`](validation/phase-4/README.md) | How the disposable validation works + findings that changed the design. |
| [`validation/phase-4/validate.ts`](validation/phase-4/validate.ts) | Replays real `0001`–`0007` on disposable PGlite, applies the proposals, asserts **76 checks**. |
| [`validation/phase-4/probe-app.ts`](validation/phase-4/probe-app.ts) | **9 probes** against the real Express app (disposable DB harness). |
| [`validation/phase-4/proposed/0008_public_storefront.sql`](validation/phase-4/proposed/0008_public_storefront.sql) | Proposed additive migration: suspension overlay + confidential-note accessor, `aura_public` (zero base grants), definer discovery views, policy scoping, limiter, redirects. |
| [`validation/phase-4/proposed/0009_global_product_slugs.sql`](validation/phase-4/proposed/0009_global_product_slugs.sql) | Proposed additive migration: deterministic cross-org slug dedupe + global unique index. |
| [`validation/phase-4/proposed/rollback_0009_global_product_slugs.sql`](validation/phase-4/proposed/rollback_0009_global_product_slugs.sql) | Reviewed rollback (restores originals, removes only collision redirects, aborts on drift). |
| [`validation/phase-4/results/sql-validation.log`](validation/phase-4/results/sql-validation.log) | Executed evidence: **76 passed / 0 failed**. |
| [`validation/phase-4/results/app-probe.log`](validation/phase-4/results/app-probe.log) | Executed evidence: **9 passed / 0 failed**. |
| [`validation/phase-4/results/browser-baseline.log`](validation/phase-4/results/browser-baseline.log) | Executed evidence: **3 tests / 3 pass / 0 fail / 0 skipped / 0 todo**. |

Integrity: [`SHA256SUMS.txt`](SHA256SUMS.txt) lists the SHA-256 of each of the 13 deliverables (verify with `sha256sum -c SHA256SUMS.txt` from this directory).

## Executed evidence summary

- **SQL:** PGlite 0.5.16 / PostgreSQL 18.6, real `0001`–`0007` + proposed `0008`/`0009`/rollback → **76/76** (roles/zero-base-grants/EXECUTE/definer-view; anonymous reads + negative paths + exact API list SQL; suspension lifecycle/four-eyes/freeze/restore/note-confidentiality; slug backfill/redirects/rollback/drift; limiter isolation; double replay).
- **App probes:** real Express harness → **9/9** (no-store mount-order defect confirmed; anonymous GET/CSRF compatibility; cross-site mutation refusal; uniform API 404; authenticated seller requirement).
- **Browser baseline:** **3/3** (auth/verification/recovery/protected routes; seller onboarding→approval; catalogue→configurator→local cart→unavailable checkout containment). Sandbox-only NSS workaround; no repository file changed for it. Hosted CI (`google-chrome`) remains the authoritative browser gate.

These are **local disposable-engine results**, not a production-readiness claim. Deployed grants/PostgREST exposure remain an owner gate.

## Re-running the validation (optional)

The scripts resolve the real ledger and test harness **two levels up** from themselves (`../../supabase/migrations`, `../../tests/support/app`). They were executed with `validation/phase-4/` at the **repository root**. To re-run from this review layout, make those reachable two levels up, e.g. from the repository root:

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
ln -s ../supabase phase-4-review-materials/supabase   # temporary, do not commit
ln -s ../tests    phase-4-review-materials/tests      # temporary, do not commit
node --import tsx phase-4-review-materials/validation/phase-4/validate.ts
node --import tsx phase-4-review-materials/validation/phase-4/probe-app.ts
# Browser baseline (sandbox NSS workaround documented in validation/phase-4/README.md):
corepack pnpm build
LD_LIBRARY_PATH=/tmp/al2023/lib corepack pnpm test:browser
```

Alternatively, copy `phase-4-review-materials/validation/` to a checkout root that already contains `supabase/migrations/` and `tests/`, and run there. The committed `results/*.log` files are the executed evidence.

## Owner corrections reflected (2026-11-27)

- **D-01:** no public seller storefronts in Phase 4; HOLO preview/configurator routes preserved.
- **D-02:** anonymous access limited to minimum slug-keyed product-discovery fields; zero base-table grants; SECURITY DEFINER discovery views; no internal ids / seller identity / disclosure.
- **D-03:** reversible suspension overlay; note confidential to authorized seller owners/admins + platform admins; four-eyes for suspend **and** restore.
- **D-04:** global slug uniqueness; deterministic collision migration; predictable legacy URL behaviour; drift-aborting rollback; preserved records; no seller renames.

The decision register (§19 of the master specification) separates **Class I** (owner approval), **Class II** (technical decisions within approved requirements), and **Class III** (deferrable to later phases).
