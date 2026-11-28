# AURA Phase 4 — Review Materials (read-only)

This directory contains the **planning and validation materials only** for AURA Phase 4, published for independent owner review. It contains **no implementation changes**: no application code, no edits to the real migration ledger (`supabase/migrations/`), and no wiring into the app or CI. The proposed SQL here is a **validation artifact**, never applied to the real ledger.

- **Repository:** `Ranaprototype/Aura-website`
- **Review branch:** `arena/091f37f6-aura-website` (this session's branch name is fixed by the platform; a branch named `phase-4-review-materials` cannot be created here, so the materials live in this directory instead).
- **Base / verified master:** `b12a5596bf3b454b844c5d3b5bc83784247e300f` (PR #4 merge; unchanged).
- **Status:** **final preparation package for a single owner go/no-go decision.** Second-review corrections applied; this revision adds the standalone **[database ownership & migration prerequisites runbook](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md)**, records D-23/D-24/D-25 as **proposed defaults awaiting explicit owner confirmation (NOT approved)**, and adds executable ownership-procedure proofs (1.20–1.24). Evidence: **97/97 SQL + 16/16 cursor + 9/9 probes + 3/3 browser baseline (preserved)**. **No PR, no merge, no deployment, no Phase 4 implementation.** Implementation awaits explicit owner approval (register D-22, OPEN) plus confirmation of D-23/D-24/D-25.

## Contents (22 deliverables)

### Specification documents
| File | Purpose |
| --- | --- |
| [`AURA-MASTER-SPECIFICATION.md`](AURA-MASTER-SPECIFICATION.md) | Product requirements + the single consolidated decision register (§19, Classes I/II/III). |
| [`AURA-COMPLETE-ROADMAP.md`](AURA-COMPLETE-ROADMAP.md) | Phase sequence, scope, dependencies, acceptance criteria. |
| [`AURA-AGENT-OPERATING-RULES.md`](AURA-AGENT-OPERATING-RULES.md) | Owner authority rule + mandatory development workflow. |
| [`AURA-PHASE-4-PLAN.md`](AURA-PHASE-4-PLAN.md) | Phase 4 technical design, API contracts, the 20 review issues, migration/deployment plan, executed vs proposed evidence. |
| [`AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md`](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md) | **Deployment runbook (authoritative):** exact `aura_catalog_owner` creation/attributes, base-table ownership, migration-executor privileges + membership, SECURITY DEFINER view ownership, NOSUPERUSER/NOBYPASSRLS verification, grants/default privileges, migration order, rollback. |

### Quick-reference summaries (defer to the authoritative docs above)
| File | Purpose |
| --- | --- |
| [`AURA-PHASE-4-DATABASE-OWNERSHIP-PREREQUISITES.md`](AURA-PHASE-4-DATABASE-OWNERSHIP-PREREQUISITES.md) | Ownership prerequisite summary → points to the authoritative procedure. |
| [`AURA-PHASE-4-OWNER-DECISION-REGISTER.md`](AURA-PHASE-4-OWNER-DECISION-REGISTER.md) | Open decisions quick reference (D-22/D-23/D-24/D-25 awaiting) → spec §19. |
| [`AURA-PHASE-4-VALIDATION-EVIDENCE.md`](AURA-PHASE-4-VALIDATION-EVIDENCE.md) | Current evidence quick reference (97/16/9/3) → results logs. |
| [`AURA-PHASE-4-FINAL-IMPLEMENTATION-PLAN.md`](AURA-PHASE-4-FINAL-IMPLEMENTATION-PLAN.md) | Implementation overview (when authorized) → plan + procedure. |
| [`AURA-PHASE-4-IMPLEMENTATION-READINESS-REPORT.md`](AURA-PHASE-4-IMPLEMENTATION-READINESS-REPORT.md) | Readiness summary: NOT ready until D-22; blockers + package contents. |

### Validation package (`validation/phase-4/`)
| File | Purpose |
| --- | --- |
| [`validation/phase-4/README.md`](validation/phase-4/README.md) | How the disposable validation works + findings that changed the design. |
| [`validation/phase-4/validate.ts`](validation/phase-4/validate.ts) | Replays real `0001`–`0007` on disposable PGlite, applies the proposals, asserts **97 checks** (incl. definer ownership catalogs 1.16–1.19, **ownership-procedure proofs 1.20–1.24**, search/filter/sort 2.16–2.20, defense-in-depth simulated-grant negatives 2.21–2.29). |
| [`validation/phase-4/cursor.ts`](validation/phase-4/cursor.ts) | Reference cursor signer/verifier: HMAC-SHA256, sort-consistent keyset (`[approvedAt, slug]` / `[title, slug]`), binding to route+search+filters+sort+limit. |
| [`validation/phase-4/cursor.test.ts`](validation/phase-4/cursor.test.ts) | **16 executable cursor tests**: contract negatives (tamper, mismatch, malformed) + PGlite pagination coverage (no duplicates/omissions; newest/title/search). |
| [`validation/phase-4/probe-app.ts`](validation/phase-4/probe-app.ts) | **9 probes** against the real Express app (disposable DB harness). |
| [`validation/phase-4/proposed/0008_public_storefront.sql`](validation/phase-4/proposed/0008_public_storefront.sql) | Proposed additive migration: suspension overlay + confidential-note accessor, `aura_public` (zero base grants), definer discovery views, policy scoping, limiter, redirects. |
| [`validation/phase-4/proposed/0009_global_product_slugs.sql`](validation/phase-4/proposed/0009_global_product_slugs.sql) | Proposed additive migration: deterministic cross-org slug dedupe + global unique index. |
| [`validation/phase-4/proposed/rollback_0009_global_product_slugs.sql`](validation/phase-4/proposed/rollback_0009_global_product_slugs.sql) | Reviewed rollback (restores originals, removes only collision redirects, aborts on drift). |
| [`validation/phase-4/results/sql-validation.log`](validation/phase-4/results/sql-validation.log) | Executed evidence: **97 passed / 0 failed**. |
| [`validation/phase-4/results/cursor-tests.log`](validation/phase-4/results/cursor-tests.log) | Executed evidence (reported separately per owner request): **16 passed / 0 failed**. |
| [`validation/phase-4/results/app-probe.log`](validation/phase-4/results/app-probe.log) | Executed evidence: **9 passed / 0 failed**. |
| [`validation/phase-4/results/browser-baseline.log`](validation/phase-4/results/browser-baseline.log) | Executed evidence: **3 tests / 3 pass / 0 fail / 0 skipped / 0 todo**. |

Integrity: [`SHA256SUMS.txt`](SHA256SUMS.txt) lists the SHA-256 of each of the 22 deliverables (verify with `sha256sum -c SHA256SUMS.txt` from this directory).

## Executed evidence summary

- **SQL:** PGlite 0.5.16 / PostgreSQL 18.6, real `0001`–`0007` + proposed `0008`/`0009`/rollback → **97/97** (roles/zero-base-grants/EXECUTE/definer-view + **ownership catalogs**; **ownership-procedure proofs 1.20–1.24** — executor membership enables reassignment / non-member denied / member-of-owner RLS bypass / note-accessor helper EXECUTE necessary+sufficient / public login view-only; anonymous reads + negative paths + exact API list SQL + **search/attribute-filter/title-sort**; **defense-in-depth simulated-grant negatives**; suspension lifecycle/four-eyes/freeze/restore/note-confidentiality; slug backfill/redirects/rollback/drift; limiter isolation; double replay).
- **Cursor (reported separately):** `cursor.test.ts` → **16/16** (round-trip; tampered payload/signature; wrong secret; mismatched route/search/category/attribute/sort/limit; attr-order independence; malformed payloads; PGlite pagination with no duplicates/omissions for newest, title and search-bound lists).
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
node --import tsx phase-4-review-materials/validation/phase-4/cursor.test.ts
node --import tsx phase-4-review-materials/validation/phase-4/probe-app.ts
# Browser baseline (sandbox NSS workaround documented in validation/phase-4/README.md):
corepack pnpm build
LD_LIBRARY_PATH=/tmp/al2023/lib corepack pnpm test:browser
```

Alternatively, copy `phase-4-review-materials/validation/` to a checkout root that already contains `supabase/migrations/` and `tests/`, and run there. The committed `results/*.log` files are the executed evidence.

## Final consistency & security review (this revision)

Performed across all planning documents and the proposed SQL before publishing:

- **Decision register:** D-23/D-24/D-25 are recorded as **proposed defaults awaiting explicit owner confirmation — NOT approved** (summary table + per-entry status). D-22 remains OPEN. No discovery UX choice is marked approved.
- **Counts consistent everywhere:** SQL **97**, cursor **16**, probes **9**, browser **3**; **22 deliverables**. No stale `92`/`76` live counts remain.
- **Ownership procedure wired in:** plan header, §4.3, §6.1 (prerequisite step 0), §6.3, §6.4 (gate G1), §9; roadmap; spec §20; both READMEs. All relative markdown links resolve.
- **Proposed-SQL security sweep:** zero base-table `GRANT … TO aura_public`; zero function `EXECUTE` to `aura_public`; five SECURITY DEFINER discovery views + §8 ownership reassignment present; definer function `search_path` pinned (`pg_catalog, aura`); defense-in-depth public policies enforce approved seller + no suspension.
- **Executable ownership proofs added (1.20–1.24):** member executor can reassign ownership / non-member denied / member-of-owner bypasses catalog RLS (ENABLE not FORCE) / note-accessor owner needs explicit helper EXECUTE / public login inherits view-only SELECT. All pass.
- **Evidence regenerated:** SQL 97/97, cursor 16/16, probes 9/9 (byte-identical re-run); browser baseline 3/3 preserved unchanged.

## Owner corrections reflected (2026-11-27)

- **D-01:** no public seller storefronts in Phase 4; HOLO preview/configurator routes preserved.
- **D-02:** anonymous access limited to minimum slug-keyed product-discovery fields; zero base-table grants; SECURITY DEFINER discovery views; no internal ids / seller identity / disclosure.
- **D-03:** reversible suspension overlay; note confidential to authorized seller owners/admins + platform admins; four-eyes for suspend **and** restore.
- **D-04:** global slug uniqueness; deterministic collision migration; predictable legacy URL behaviour; drift-aborting rollback; preserved records; no seller renames.

The decision register (§19 of the master specification) separates **Class I** (owner approval), **Class II** (technical decisions within approved requirements), and **Class III** (deferrable to later phases).
