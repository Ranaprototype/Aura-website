# AURA Master Specification

**Status:** authoritative product specification · planning baseline · **not a release certification**
**Verified baseline:** `master` = `b12a5596bf3b454b844c5d3b5bc83784247e300f` (merge of PR #4, Phase 3), verified against `origin/master` on 2026-11-27. Working branch: `arena/091f37f6-aura-website`.
**Companion documents:** [AURA-COMPLETE-ROADMAP.md](AURA-COMPLETE-ROADMAP.md) · [AURA-AGENT-OPERATING-RULES.md](AURA-AGENT-OPERATING-RULES.md) · [AURA-PHASE-4-PLAN.md](AURA-PHASE-4-PLAN.md)

This document consolidates what AURA is, what exists today, what is approved but unbuilt, what is future, and what still needs an owner decision. It is the single product source of truth. Phase reports are historical evidence, not requirements.

---

## 1. Source-of-truth hierarchy

When documents disagree, resolve in this order (highest first). Never silently change an approved policy; record the conflict and ask the owner when the resolution would change product behaviour, permissions, exposure or scope.

| Rank | Source | Controls |
| --- | --- | --- |
| 1 | Owner's explicit instructions and recorded approvals (this conversation and the decision register below) | Everything. A recommendation is never approval. |
| 2 | **AURA-MASTER-SPECIFICATION.md** (this file) | Product requirements, capability definitions, status classification, the consolidated owner decision register (§19). |
| 3 | **AURA-COMPLETE-ROADMAP.md** | Phase sequence, phase scope, dependencies, acceptance criteria, exclusions. |
| 4 | **AURA-PHASE-4-PLAN.md** (and later approved phase plans) | Technical design within the approved scope of that phase. |
| 5 | **AURA-AGENT-OPERATING-RULES.md** | Process, authority boundaries, workflow, evidence standards. |
| 6 | Architecture set: `AURA-PLATFORM-ARCHITECTURE.md`, `AURA-DATABASE-ARCHITECTURE.md`, `AURA-API-ARCHITECTURE.md`, `AURA-SECURITY-ARCHITECTURE.md`, `AURA-ARCHITECTURE-DECISIONS.md`, `AURA-API-STANDARDS.md`, `AURA-SECURITY-STANDARDS.md`, `AURA-TESTING-STRATEGY.md` | Technical contracts and ADRs. Where a newer approved phase plan refines an implementation detail, the phase plan wins and the refinement is recorded. |
| 7 | Phase reports (`AURA-PHASE-0-…` … `AURA-PHASE-3-REPORT.md`) | Historical evidence only. Several contain statements that were true on a branch and are now merged, or are outdated (see §18). |
| 8 | **Code, migrations and tests in the repository** | Ground truth for what *exists*. Any "implemented" claim in a document must match the code at the stated commit. |

Rules:

- Code wins over any document about **what exists**; documents win over code about **what should exist**.
- Do not create duplicate or contradictory specifications. New product requirements land here; new phase scope lands in the roadmap; new technical designs land in the phase plan; process changes land in the operating rules.
- The owner decision register (§19) is the **only** place questions are consolidated. Do not scatter questions across documents or messages.

## 2. Status classification

Every capability below is tagged:

- **A — Implemented.** Exists in code at the baseline commit, with tests. Evidence paths are given.
- **B — Approved architecture, not implemented.** Design exists in the architecture set / ADRs / approved phase plans; no code claims it.
- **C — Future planned.** Direction agreed in principle; detailed design and often provider/legal decisions are pending.
- **D — Unresolved owner decision.** Tracked in §19; implementation of the dependent scope is blocked until answered.

"Implemented" never means "deployed" or "production-ready". Nothing in this repository is deployed; no shared or production database has been verified (see §17).

## 3. Product vision

AURA is a design-first commerce platform. The complete journey:

> **Discover → Design → Customize → Share → Validate demand → Manufacture together → Purchase.**

- Customers discover products and designs, generate and edit designs with AI, customize them in 3D, share them with a community, and signal demand.
- Sellers offer approved catalogue products; manufacturers review exact design specifications, quote feasibility, and run collective manufacturing campaigns funded by explicit customer commitments.
- Administrators operate scoped, audited review and moderation workflows with separation of duties.
- The visual language is **HOLO** (existing React/Tailwind/Radix design system). The storefront, configurators, cart and wishlist that exist today are **design previews**, not authoritative offers; they are preserved until an approved phase replaces a specific data source.
- Future automotive customization must reuse the same verified design, specification and manufacturing gates plus specialist/safety approval. It is not scheduled.

Non-negotiable product invariants (from the approved architecture):

- Generated image ≠ validated specification ≠ manufacturable item ≠ approved listing.
- Interest ≠ commitment ≠ settled payment.
- A revision, quote expiry or withdrawn publication never silently changes a purchased specification or grants further public access.
- Nothing is purchasable without platform approval; no card data is ever collected by AURA; AI proposes, humans authorize.

## 4. Authentication, accounts, organizations, permissions

**A — Implemented** (Phases 0–2; `server/auth/*`, `server/modules/{auth,authorized,workspace}.ts`, migrations `0002_identity.sql`, `0003_email.sql`, `0004_roles.sql`):

- Local identity: scrypt password hashing (per-user salt, constant-time compare), opaque server-side sessions (only SHA-256 token hash stored), `aura_session` cookie `HttpOnly`/`SameSite=Lax`/`Secure` in production, idle/absolute expiry, revocation on logout/password reset.
- Single-use hashed email tokens for verification and password reset; seven transactional email templates; SMTP delivery post-commit with idempotency, retries and redacted logs.
- CSRF double-submit (`aura_csrf` cookie + `x-csrf-token` header) plus session-bound token verification; origin/`Sec-Fetch-Site` allowlist for all of `/api/v1` unsafe methods.
- Organizations, memberships (`owner/admin/member/viewer`), invitations (email-bound, expiring, single-use), last-owner protection, role-authority rules — enforced in security-definer functions and RLS, not only routes.
- Platform administration is a separate global grant (`aura.platform_admins`), provisioned out of band; never an organization role; no environment/header shortcut.
- Optional Supabase token login (`/api/v1/auth/supabase`) verified server-side against the configured issuer; `501` when unconfigured.
- Rate limits for registration/login/recovery in `aura.auth_rate_limits` (hashed keys).

**B — Approved architecture, not implemented:** managed OIDC option (ADR-03), MFA/step-up for sensitive roles, customer private profile/addresses, session policy tuning, in-app notification feed.

**C — Future:** delegated/agent scoped contexts, organization suspension at identity level (distinct from marketplace suspension, Phase 4).

**D — Owner decisions:** D-09 (identity provider authority), D-17 (session/cookie/password/retention policy), D-18 (verified email for invitation acceptance), D-19 (platform-admin provisioning process).

## 5. Marketplace and product catalogue

**A — Implemented** (Phase 3; `server/modules/marketplace/*`, migrations `0005`–`0007`, `shared/marketplace.ts`, four client screens):

- Seller profile per organization with `draft → submitted → approved/rejected` lifecycle; business-information edits on an approved seller return it to draft for re-review.
- Products with `draft → submitted → approved/rejected → archived` lifecycle; immutable numbered revision snapshots; variants, external `https` media **references** (no uploads), typed category attributes; three seeded categories (sneakers, apparel, accessories) with typed attribute definitions, migration-managed.
- Purchasability is **derived**, never stored: `status='approved'` AND `pending_changes=false` AND an approved revision pointer AND an approved seller. Any content edit (including child rows) withdraws it in the same transaction (`catalogue_child_guard`).
- Four-eyes review separation (`0007_review_separation.sql`): a platform admin who is an active member of the organization cannot decide its seller/product/revision — enforced in the database and pre-checked in the API.
- Append-only `audit_events`; products are archived, never deleted; revisions/audit never updated/deleted by the runtime.
- `aura.storefront_products` projection (security-invoker view) — **not exposed over HTTP** at baseline. No public catalogue endpoint exists (verified: `GET /api/v1/storefront/products` → `404 not_found`).
- **No price, currency, stock, shipping or manufacturing field exists anywhere** — by design.

**B — Approved, not implemented:** public storefront read API and pages, globally unique slugs + redirects, seller suspension (all designed in [AURA-PHASE-4-PLAN.md](AURA-PHASE-4-PLAN.md)); offers/pricing, inventory, server cart, orders (roadmap Phase 5).

**C — Future:** search/indexing, recommendations, media uploads/CDN (replaces URL references under an approved storage policy), seller-initiated slug renames.

**D — Owner decisions:** D-01 (public URL scheme vs preview configurators), D-02 (public field allowlist), D-04 (global slug policy), D-15 (taxonomy ownership), D-16 (withdrawal/un-archive), D-20 (catalogue write rate limits).

## 6. Seller management and product approval

**A — Implemented:** onboarding, review queues (`/admin/review`), approve/reject with mandatory rejection notes, audit trail, role matrix (`CATALOG_WRITE_ROLES = owner/admin/member`, `CATALOG_MANAGE_ROLES = owner/admin`), viewer read-only, cross-tenant denial at six layers (header→membership, explicit `org_id` filters, RLS, composite tenant FKs, read-only reference data, server-derived identity).

**B — Approved, not implemented (Phase 4 plan):** suspension/restoration as a state-preserving overlay with four-eyes protection, mandatory note, frozen seller catalogue writes while suspended, immediate public de-publication, admin cleanup of submitted items still allowed; public seller profile pages.

**D:** D-03 (suspension semantics confirmation), D-14 (review delegation / second-reviewer policy).

## 7. AI design generation and editing

**A — Implemented:** nothing. No model provider, no generation endpoint, no design tables.

**B — Approved architecture** (`AURA-PLATFORM-ARCHITECTURE.md` AI subsystem, ADR-09): capability-specific adapters (generate/edit/rank/embed/cluster/assist), versioned prompt templates and models, immutable design revisions with parentage and provenance, job records (actor, tenant, input hash, parameters, policy version, budget reservation, result refs), per-user/org concurrency and hard spend ceilings enforced before dispatch, outputs treated as untrusted media (schema validation, scanning), owner-scoped retrieval, no autonomous authorization. Editing forks a child revision; approved history is never mutated.

**C — Future:** semantic/vector search (only if justified), demand clustering, manufacturer assistance drafts.

**D:** D-07 (provider selection, spend ceilings, retention/no-training terms, consent). Blocked for any implementation.

## 8. 3D product customization

**A — Implemented (preview only):** HOLO configurators — `/product/sneaker` (`SneakerConfigurator`) and `/products/:slug` (`GenericConfigurator`) driven by the client-only catalogue in `client/src/lib/catalog.ts` (16 preview products). These are design previews: browser-local selections, no authoritative spec, no server persistence, no purchase path. They must keep working until an approved phase replaces a specific data source.

**B — Approved architecture:** versioned parameter sets pinned to option-schema/geometry versions, unit and constraint validation, compatibility rules, design-revision references; visual fit is not a feasibility test; a customization references a variant + design revision, never confers manufacturing approval.

**C — Future:** engine/asset-format selection, real geometry pipeline, automotive-specific constraints.

**D:** D-01 (route coexistence) affects how marketplace detail pages link to configurators.

## 9. Community and creator ecosystem

**A — Implemented:** nothing beyond the preview storefront and device-local wishlist.

**B — Approved architecture:** public profiles as a separate projection from private customer profiles; publication of an authorized design revision only with explicit share consent; moderated comments; likes/saves unique per principal+subject (saves private); takedown revokes delivery/index/CDN access; social counts confer no purchase rights; rate limits and moderation reporting.

**C — Future:** creator analytics, collections, follows.

**D:** privacy/consent and retention policies (D-10) gate publication features.

## 10. Product Lab and demand intelligence

**A — Implemented:** nothing.

**B — Approved architecture:** customer suggestions/proposals/discussions for a defined problem; proposals reference consented community inputs; demand clusters are versioned aggregate evidence (date range, methodology, model version, uncertainty), revisable and never binding; a proposal is not a listing; interest is not commitment.

**C — Future:** cluster→candidate-spec workflow feeding manufacturer review.

**D:** D-07 (model terms) for clustering; D-11 for any demand→campaign conversion rules.

## 11. Collective manufacturing

**A — Implemented:** nothing.

**B — Approved architecture** (ADR-08, platform/database/security architecture): manufacturer verification is a human decision distinct from seller approval; feasibility review against an **exact immutable spec revision**; time-limited quote versions (quantity bands, amount/currency, capacity, expiry); campaigns pin quote + terms version + threshold + deadline + cancellation conditions; commitments record explicit customer assent (units, terms version, consent receipt); serialized close/cancel under lock; below threshold → lapse/release/reconcile, no production; above → await funding and authorized production release; production orders → batches → QA evidence → release/hold; fulfillment allocates released units. AI never signs feasibility or authorizes money.

**C — Future:** multi-manufacturer sourcing, capacity marketplace.

**D:** D-11 (jurisdictions, consent evidence, eligibility, partial funding, cancellation/expiry/refund rules) — hard gate before any campaign feature.

## 12. Orders, payments and refunds

**A — Implemented:** explicit **denials**. Checkout collects no payment details and persists nothing; order confirmation and account order lookup render unavailable states; cart/wishlist are device-local previews with consistent estimate math. Containment tests enforce this (`tests/containment.test.tsx`, `tests/browser.mjs`).

**B — Approved architecture** (ADR-07): server cart → repriced quote → checkout intent → order with immutable snapshots and vendor-scoped suborders; inventory reservations atomic with order creation; hosted provider checkout only (AURA never sees PAN/expiry/CVC); signature-verified, deduplicated webhook inbox drives settlement; redirects never confirm payment; refunds require human approval distinct from settlement, cumulative refunds ≤ captured amount; uncertain outcomes reconcile via authenticated provider reads; integer minor units + currency everywhere.

**C — Future:** multi-currency, tax automation, disputes, payouts/seller settlement identity.

**D:** D-06 (provider, merchant of record, currencies, tax, refund policy) — hard gate before Phase 6.

## 13. Notifications and communication

**A — Implemented:** seven transactional email templates (verify, welcome, reset, invitation, role-changed, access-revoked, session-security) with HTML+text, idempotency keys (`aura.email_events`), per-recipient limits, bounded retries, post-commit delivery, redacted logs. Local SMTP sink in tests; no real provider provisioned.

**B — Approved architecture:** notifications consume committed domain events via PG outbox; in-app notification feed; delivery attempts and pruning; email cannot commit a transaction.

**C — Future:** push, digests, preference center.

**D:** D-10 (provider/DNS/retention), D-17 (retention of email events).

## 14. AI agents and approval boundaries

**A — Implemented:** nothing autonomous. The platform-admin grant and four-eyes guards are the only "agent-like" privileged paths, and they are human-operated.

**B — Approved architecture:** agents request scoped actions through the same APIs/policies as other callers; short-lived delegated context; action proposals bound to who/role/org/action/target-version/terms-hash/expiry/purpose; humans approve spend, commitments, refunds, production release, capability verification and privilege escalation; workers execute an already-approved command once, rechecking membership/version/limits/approval validity; replay prevented; no SQL/admin tokens or financial tools for autonomous execution.

**C — Future:** richer agent tooling per domain once the approval framework exists.

**D:** approval thresholds and separation-of-duties policy are owner sign-off items within D-06/D-11 and the security architecture.

## 15. Security and privacy

**A — Implemented controls:** session/CSRF/origin machinery; scrypt; hashed tokens; RLS on every tenant table; non-owner runtime role (`aura_app`, no BYPASSRLS, no ownership); security-definer functions with pinned `search_path` and PUBLIC EXECUTE revoked; composite tenant FKs; append-only audit; strict zod DTOs (unknown fields rejected, 16/32 kB caps); uniform error codes; no-store on diagnostics/404 paths (**v1 responses currently lack it — a confirmed defect the Phase 4 plan corrects**); production config fail-closed; secrets server-only; no service-role key; diagnostics loopback-gated and off by default.

**Open incidents (owner-led, separate track):** historical unsafe checkout persistence and historical credential exposure (`SECURITY.md`, `AURA-SECURITY-STANDARDS.md`). Not closed by any local change; do not inspect/migrate/delete historical browser records.

**B — Approved target controls:** the full threat/control/evidence matrix in `AURA-SECURITY-ARCHITECTURE.md` (identity boundary verification gate, payment boundary, media quarantine, community/search leakage, operator/agent boundaries), CSP/TLS after compatibility tests, trusted-proxy policy, backup/restore drills, retention/deletion/legal-hold policy.

**D:** D-02 (public exposure), D-03 (suspension), D-05 (caching policy), D-10 (privacy/retention/regions), plus the incident response track.

## 16. Database and backend architecture

**A — Implemented:**

- One Express modular monolith (`server/app.ts` composition; modules `auth`, `workspace`, `marketplace`, `diagnostics`; `authorized()` transaction wrapper binding verified principal/org transaction-locally).
- PostgreSQL via `pg` pool (`server/db/database.ts`); one transaction per request; `set_config(..., true)` identity; `DISCARD ALL` + connection discard on uncertain state; statement/query timeouts.
- Schema `aura` (private), migrations `0001`–`0007`: identity/tenancy/email/roles + seller/catalogue + review separation. `public.hello` is a Phase 0 diagnostic only.
- Roles: `aura_app` group (nologin, noinherit, nosuperuser, nobypassrls); production login inherits it. Grants are least-privilege per table; reference data read-only; no DELETE on products/revisions/audit.
- RLS: member/admin policies + platform-admin policies; lifecycle guards and audit triggers; four-eyes guard.
- Verified at baseline: `corepack pnpm check` clean; **18 test files / 294 tests pass** (61.5 s); migration replay `0001`–`0007` on PGlite 0.5.16 / PostgreSQL 18.6.

**B — Approved, not implemented:** `aura_public` read role + separate pool, public projections and column allowlists, suspension overlay, global slugs + redirects, isolated public rate limits (Phase 4 plan, validated); outbox/inbox + leased workers (Phase 5+); inventory/order/payment tables (Phase 5/6).

**C — Future:** Redis only if measured need; read replicas; vector search only if justified.

**Known evidence limit:** PGlite is single-process WASM PostgreSQL. It proves SQL/RLS/trigger/policy behaviour, not multi-backend contention, deployed grants, or PostgREST exposure. Deployed verification is an owner gate (§17).

## 17. Frontend and design system; testing, deployment, operations

**Frontend (A):** React 19 + Vite + Tailwind + Radix UI (`client/src/components/ui/*`), HOLO tokens in `client/src/index.css` (~8.5k lines; additive `market-*` block from Phase 3), hand-rolled pathname router in `App.tsx`, `shared/routes.ts` SPA document allowlist, same-origin relative API calls with `credentials: "include"` + CSRF header (`client/src/lib/api.ts`). Routes: storefront previews (`/`, `/catalog`, `/category/:slug`, `/product/sneaker`, `/products/:slug`, `/compare`, `/cart`, `/checkout`, `/order-confirmation`, `/account/*`), auth (`/sign-in`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/accept-invitation`), `/workspace`, `/seller`, `/seller/products`, `/seller/products/:id`, `/admin/review`, `/test-supabase`. Rule: additive changes; preserve HOLO identity, routes, keyboard behaviour and containment denials.

**Testing (A):** Vitest (18 files / 294 tests at baseline), jsdom UI suites, real-Express HTTP suites, disposable PGlite over the wire protocol with the real `pg` pool and restricted role, local SMTP sink, Playwright Chromium browser suites (`tests/browser*.mjs`, 3 tests — re-verified 3/3 locally on 2026-11-27 via the documented sandbox library workaround), PR-only GitHub Actions workflow `.github/workflows/phase-0.yml` (frozen install, typecheck, tests, build, browser, high-severity audit). Latest hosted run on the Phase 3 PR: `45943762715` — success.

**Deployment/operations (B, nothing provisioned):** local loopback only today. Private staging and production require separate owner approval: isolated environments/credentials, TLS, backups + restore drills, RPO/RTO, monitoring/alerting, migration ledger + effective-grant verification on the target, rollback rehearsal. CI verifies; it does not deploy. **No local test result is a production-readiness claim.**

**D:** D-10 (hosting, regions, retention, recovery objectives), D-05 (caching/CDN policy).

## 18. Documentation corrections (outdated statements found at baseline)

| Location | Outdated statement | Correction (verified at `b12a559`) |
| --- | --- | --- |
| `AURA-MASTER-ARCHITECTURE.md` | "Implemented through Phase 3 (branch only, awaiting review)… Nothing here is merged or deployed." | Phases 0–3 are **merged** (PRs #1–#4; master `b12a559`). Still nothing deployed. |
| `AURA-PHASE-3-ARCHITECTURE.md`, `AURA-PHASE-3-REPORT.md` | "not merged", "HEAD/master still `5d30260…`", "uncommitted in working tree" | Historical branch-state statements; PR #4 merged 2026-11-27 (`b12a559`). Reports remain valid as evidence of what was tested. |
| `AURA-PHASE-2-REPORT.md` | CSRF header named `x-aura-csrf` | Actual header is **`x-csrf-token`** (`server/modules/authorized.ts`, `tests/support/app.ts`). Cookie is `aura_csrf`. |
| `AURA-API-STANDARDS.md` / Phase 0 claim | "API responses are `no-store`" | True for diagnostics/404 catch-all; **false for `/api/v1` responses** — the no-store middleware is mounted after the v1 routers (`server/app.ts`). Confirmed by executed probe (`validation/phase-4/results/app-probe.log`, A.3). Phase 4 plan corrects the mount order. |
| `AURA-TESTING-STRATEGY.md` | "browser suite … currently blocked locally" | Resolved in the Phase 3 audit (portable Chromium launch); hosted CI runs it green. This sandbox lacks NSS libs, but the documented `al2023.tar.br` + `LD_LIBRARY_PATH` workaround makes the suite pass locally (3/3, executed 2026-11-27). CI remains the authoritative browser gate. |
| `AURA-PHASE-4-PLAN.md` referenced in owner instructions | Assumed to exist | **No such file exists in any commit, branch or PR** (verified: `git log --all -- AURA-PHASE-4-PLAN.md` empty; `git ls-remote` shows only master + four merged phase branches). The revised plan is created fresh from the owner's 20-issue review list. |

These corrections are recorded here so future agents do not re-litigate them. The historical reports are not rewritten.

## 19. Consolidated owner decision register

**This is the only decision register.** It distinguishes the three classes the owner requires:

- **Class I — Owner decisions requiring explicit approval.** Product behaviour, business rules, public data exposure, privacy/disclosure, permissions, security boundaries, architecture, phase scope and user-facing workflows. A recommendation is never approval.
- **Class II — Technical implementation decisions already covered by approved requirements.** Taken by the agent within approved requirements; recorded so they are not reconsidered. No owner approval needed.
- **Class III — Decisions deferrable to later phases.** Each carries the gate at which it must be decided.

**Status of D-01–D-04:** on 2026-11-27 the owner issued explicit corrections resolving these four decisions (remove public seller storefronts from Phase 4; minimise anonymous discovery data; restrict suspension-note visibility; keep global slugs with predictable legacy behaviour and no seller renames). They are recorded below as **OWNER-DIRECTED** and are reflected in the proposed SQL and validation evidence. **Implementation approval is still withheld** — the only remaining Class I gate for Phase 4 is the owner's explicit go-ahead to implement. Previously approved requirements are preserved and are **not** re-asked.

### Class I — Owner decisions requiring explicit approval

#### D-01 · Public storefront URL scheme and preview-configurator coexistence — OWNER-DIRECTED (2026-11-27)
- **Owner decision:** Preserve all existing HOLO preview/configurator routes (`/products/:slug` → `GenericConfigurator`, `/catalog`). Add an additive marketplace namespace: `/marketplace` (list) and `/marketplace/product/:slug` (detail). **Public seller storefronts (`/marketplace/seller/:id`) are OUT of Phase 4** and require separate owner approval (see D-21). A later owner-approved phase may migrate previews onto real data one use case at a time.
- **Why it matters:** `/products/:slug` is an existing user-facing workflow; hijacking it changes approved behaviour and breaks preview deep links and browser tests. Public seller pages expose seller identity/disclosure, a privacy decision the owner has not approved.
- **Alternatives considered:** (a) replace `/products/:slug` now (breaks previews/tests); (b) resolve preview slug first then marketplace (ambiguous collisions). Both rejected.
- **Consequences:** Zero breakage to previews; slightly longer marketplace URLs; no public seller surface in Phase 4.
- **Reflection in proposal:** `public_seller_profiles` view removed; no seller route in the plan; browser baseline (HOLO routes) re-run unchanged 3/3.

#### D-02 · Public data exposure — minimum product-discovery allowlist — OWNER-DIRECTED (2026-11-27)
- **Owner decision:** Anonymous access is restricted to the **minimum product-discovery information**. **Never exposed:** internal organization ids, internal product/revision ids, seller organization identifiers, reviewer information, legal information, business email addresses, or other private identifiers. **Seller identity and disclosure fields (country, website, description, display name) require explicit approval and are NOT exposed in Phase 4** (deferred with D-21).
- **Validated public allowlist (definer views, slug-keyed):**
  - `public_products`: `slug, title, summary, description, approvedAt, categorySlug, categoryName`. **No** product id, org id, revision id, seller id or seller fields.
  - `public_product_variants`: `productSlug, title, size, colour, material, position` — **no variant id, no SKU**.
  - `public_product_media`: `productSlug, kind, url, altText, position` — **images only** (`kind='reference'` hidden), **no media id**.
  - `public_product_attributes`: `productSlug, key, label, value, position` — **no attribute id**.
  - `public_slug_redirects`: `slug → canonicalSlug` for published products only — **no product/org id**.
- **Mechanism (Class II, T-02):** `aura_public` has **zero base-table SELECT grants**; the five projections are SECURITY DEFINER views whose `WHERE` encodes the full publication predicate. Internal ids are used only inside the view joins and are never selectable.
- **Alternatives considered:** expose SKU / reference media / business_email / seller disclosure — all rejected as privacy leakage or pending approval.
- **Consequences:** Minimal anonymous surface; private columns unreachable even by direct base query (validated 2.6–2.8); seller discovery deferred.

#### D-03 · Seller suspension semantics and note confidentiality — OWNER-DIRECTED (2026-11-27)
- **Owner decision:** Retain the reversible suspension **overlay** (`suspended_at/by/note`), not a lifecycle status. Effects: immediate de-publication of the seller and all its products; all seller-side catalogue writes frozen; platform-admin review of already-submitted items still allowed; restoration clears the overlay and returns the **exact** prior status/approval. **Four-eyes separation applies to BOTH suspension and restoration.** A note is mandatory; suspension cannot be mixed with content/status edits in one statement; every decision audited. **The suspension note is visible only to explicitly authorized seller owners/admins and platform administrators — NOT every organization member.** Organization members keep dashboard read access and see the suspension *state* (`suspended_at`), but not the note text.
- **Mechanism (Class II, T-03):** `suspension_note` is hidden from `aura_app` by column grant; authorized readers use the `aura.seller_suspension_note(uuid)` SECURITY DEFINER accessor (checks owner/admin membership or platform admin). Member-readable audit detail records `noteRecorded: true`, never the note text.
- **Alternatives considered:** (a) new `suspended` status (loses prior state); (b) allow draft edits while suspended; (c) identity-level suspension (blocks login). All rejected.
- **Consequences:** State-preserving, reversible, note confidential to authorized roles. Validated 3.1–3.25.

#### D-04 · Global slug policy — OWNER-DIRECTED (2026-11-27)
- **Owner decision:** Retain **global slug uniqueness**. Deterministic migration: the earliest product (`created_at`, `id`) keeps a colliding slug; later duplicates gain a deterministic id-derived suffix (`<slug≤72>-<id:8>`); original slugs recorded in `aura.slug_redirects` with `replacement_slug` and `reason='global_collision'`. **Predictable legacy URL behaviour:** resolution checks live products first, then redirects of published products; a collision redirect whose slug is still live is inert and can never hijack the kept product. **Rollback** restores originals and aborts on post-migration drift. **Existing product records are preserved** (timestamps unchanged; renames audited). **No seller-controlled slug renaming in Phase 4** (slugs stay immutable post-creation as today); a rename feature is D-13.
- **Alternatives considered:** (a) per-org slugs namespaced by seller (couples URLs to seller identity, breaks on rename); (b) allow seller renames now (scope + redirect-abuse surface). Both rejected.
- **Consequences:** Stable clean URLs, one-time deterministic reversible migration. Validated 4.1–4.14.

#### D-21 · Public seller storefronts and seller identity/disclosure exposure — OPEN (deferred, separate approval)
- **Question:** When (and whether) to expose public seller pages (`/marketplace/seller/:id`) and seller identity/disclosure fields (display name, country, website, description)?
- **Why it matters:** This is a privacy/disclosure policy decision the owner has explicitly reserved. Split out of D-01/D-02 by the 2026-11-27 correction.
- **Recommendation:** Defer to a later owner-approved phase with a defined disclosure policy (what is public, consent, legal review). Phase 4 exposes no seller identity.
- **Gate:** Separate owner approval before any public seller surface or seller disclosure field is added.

#### D-22 · Phase 4 implementation go-ahead — OPEN
- **Question:** Approve implementation of Phase 4 exactly as specified in `AURA-PHASE-4-PLAN.md` and the proposed migrations, per the owner-directed D-01–D-04?
- **Why it matters:** The owner has withheld implementation approval pending review of the corrected documents and evidence.
- **Gate:** Explicit owner authorization before any implementation, commit, push, PR, merge or deploy.

### Class II — Technical implementation decisions already covered by approved requirements (no approval needed)

| ID | Decision | Rationale / evidence |
| --- | --- | --- |
| T-01 | Scope every helper-calling RLS policy `TO aura_app` (`ALTER POLICY`) instead of granting helper EXECUTE to the public role. | Executed validation proved public reads otherwise fail with `permission denied for function is_active_member`; granting EXECUTE + caller-set principal would create a membership oracle. `validation/phase-4/results/sql-validation.log` 1.12. |
| T-02 | Public reads = **SECURITY DEFINER discovery views** (owner-owned, no `security_invoker`) with **zero base-table grants** to `aura_public`; the view `WHERE` is the publication predicate and the view selects only slug-keyed discovery columns. Base RLS policies remain as defense-in-depth. | Directed by D-02: `security_invoker` + column grants cannot hide internal ids (every join/predicate column would be granted and directly queryable). Definer views expose no internal identifier and call no functions (no search_path execution hazard). Validated 1.3–1.5/1.14/2.x. |
| T-03 | Suspension as overlay columns, not a new status value; the confidential note is hidden from `aura_app` by column grant and read only through the `aura.seller_suspension_note(uuid)` definer accessor (owner/admin of the org or platform admin); audit detail records `noteRecorded`, never the note text. | Preserves approved state exactly; enforces D-03 note confidentiality. Validated 1.15/3.2/3.5–3.10/3.21/3.25. |
| T-04 | Backfill disables only `products_guard`, `products_touch`, `products_catalogue_suspension` (owner privilege; no `session_replication_role`, no superuser requirement); audit trigger stays active. | Validated 4.1/4.2 (failure without) and 4.6/4.7 (preserved timestamps, audited renames). |
| T-05 | `slug_redirects` stores `replacement_slug`; live product wins resolution; rollback aborts on drift. | Validated 4.9–4.14. |
| T-06 | Separate `aura.public_rate_limits` table; two-way grant isolation from `aura.auth_rate_limits`. | Validated 5.1–5.3. |
| T-07 | HMAC-SHA256 signed cursors via `node:crypto` (no new dependency); secret required in production, ephemeral in dev. | Tamper-evident pagination; constant-time compare. |
| T-08 | `TRUST_PROXY` explicit config (default off); `req.ip` used for rate buckets only when configured. | Prevents proxy-header spoofing and shared-bucket lockouts. |
| T-09 | Move the `no-store` header middleware before the `/api/v1` mounts. | Confirmed defect: v1 responses lack no-store today (`app-probe.log` A.3). |
| T-10 | Uniform `404 {"error":"not_found"}` for every public miss (unknown/malformed slug, draft, submitted, rejected, archived, pending-changes, suspended, redirect-to-unpublished). | No existence oracle. |
| T-11 | New module `server/modules/storefront/`; admin suspension routes reuse `requirePlatformAdmin` + four-eyes pre-check in `marketplace/review.ts` style. | Reuse, no duplicate modules. |
| T-12 | Minimum PostgreSQL 15 (`security_invoker`); no PG18-only syntax; plain `CREATE UNIQUE INDEX` in-transaction at current scale. | Production compatibility; PGlite 18.6 validates semantics only. |
| T-13 | Validation artifacts live in `validation/phase-4/` (disposable; never applied to `supabase/migrations/` or the app). | Keeps planning evidence without starting implementation. |
| T-14 | CSRF middleware unchanged for public GETs (safe methods pass; double-submit cookie issuance tolerated; responses `no-store`). | Validated A.2/A.4/A.9; no public mutations exist in Phase 4. |
| T-15 | Anonymous public reads use a separate least-privilege pool (`DATABASE_PUBLIC_URL`); absent config → `503 storefront_unavailable`, never a fallback to the app pool. | Connection isolation; fail-closed. |


### Class III — Decisions deferrable to later phases (gate noted)

| ID | Question | Recommendation | Alternatives / consequences | Gate |
| --- | --- | --- | --- | --- |
| D-05 | Public response caching: keep `no-store` everywhere, or allow short public caching/CDN later? | Keep `no-store` for Phase 4 (preserves the approved Phase 0 policy; fix the v1 mount-order defect). Revisit with a CDN phase. | Short TTL/CDN improves scale but changes approved policy and needs invalidation-on-suspension design. | Before any CDN/caching change |
| D-06 | Payment provider, merchant of record, supported currencies, tax, refund/dispute policy, payout identity | Hosted checkout with a single provider first; owner selects after commercial review. | Multiple providers early = reconciliation burden; wrong MoR = legal/tax exposure. | **Phase 6 hard gate** |
| D-07 | AI model provider(s), spend ceilings, retention/no-training terms, user consent for inputs | One image provider + one text provider, hard per-user/org budgets, approved retention/region terms, explicit consent. | Open provider choice later = adapter churn; no ceilings = runaway spend. | **Phase 8 hard gate** |
| D-08 | Object storage provider, bucket policy, upload/quarantine/scan pipeline, migration of URL media references | Private-by-default buckets, signed short-lived URLs, server-chosen keys, scan before visibility; migrate references to asset ids. | Public buckets = private-design leakage; DB blobs = WAL/restore cost. | **Phase 8 hard gate** |
| D-09 | Authoritative identity provider: keep local scrypt sessions, adopt managed OIDC, or keep Supabase token login as a secondary path | Keep local identity until a managed IdP is justified (cost/MFA/recovery/region review); Supabase login stays optional and secondary. | Early IdP migration = recovery/MFA burden; long-lived browser JWTs = revocation problems. | Before any identity-provider change |
| D-10 | Hosting/staging/production targets, regions, retention/deletion/legal holds, RPO/RTO, alerting, backup/restore ownership | Private staging first (isolated creds/data), production only after restore drills and grant verification on the target. | Shared dev/prod = incident blast radius; no RPO/RTO = unbounded recovery expectations. | **Before any deployment** |
| D-11 | Collective manufacturing legal terms: jurisdictions, consent evidence, eligibility, partial funding, cancellation/expiry/refund rules | Owner + legal define enforceable terms before any campaign; immutable terms versions. | Launching without terms = unenforceable commitments and dispute exposure. | **Phase 11 hard gate** |
| D-12 | Public caching/CDN invalidation policy (suspension, edits, takedowns) | Design with the CDN phase; invalidate on every de-publication event. | — | With D-05 |
| D-13 | Seller-initiated slug renames + redirect semantics | Defer; if approved later, reuse `slug_redirects` with `reason='rename'`, rate-limit renames, never free a slug for reuse. | Renames enable SEO fixes but create redirect churn/abuse surface. | Post-Phase 4 |
| D-14 | Review delegation / second-reviewer requirement | Keep single-reviewer + four-eyes self-review block; add delegation only when volume demands. | Mandatory second reviewer doubles review latency. | When review volume grows |
| D-15 | Category taxonomy ownership/expansion process | Migration-managed reference data; owner approves new categories/attributes via a designed migration. | Seller-editable taxonomy breaks validation invariants. | Before taxonomy expansion |
| D-16 | Withdrawal of submitted products / un-archive semantics | Keep archive-only (irreversible) for now; add withdrawal only with an owner-approved transition. | Un-archive invites approval-state confusion. | Post-Phase 4 |
| D-17 | Session TTL, subdomain cookie policy, password policy/rotation, retention of `email_events`/`auth_rate_limits` | Keep current defaults (12 h session, 60 min tokens); define pruning/retention with D-10. | Longer TTLs = larger theft window; no pruning = unbounded growth. | With D-10 |
| D-18 | Must invitation acceptance require a verified email? | Yes (safer); current flow binds the exact address but does not require verification. | Requiring verification adds a step; not requiring it risks unverified members. | Before membership policy change |
| D-19 | Platform-admin provisioning process | Keep out-of-band SQL grant with an owner-run runbook; no self-service path. | Self-service admin = privilege escalation risk. | Before admin team growth |
| D-20 | Catalogue write rate limits | Add per-principal/org write budgets when public traffic exists; ingress limits + 32 kB cap apply today. | No limits = abuse/spam surface; too tight = seller friction. | Phase 4/5 |

## 20. Assumptions and limitations

- The repository is the only verified environment. No deployed Supabase/PostgreSQL, provider, CDN or mail relay has been inspected; deployed grants/PostgREST exposure remain an owner gate.
- PGlite (PostgreSQL 18.6 WASM, single process) validates SQL semantics, not multi-backend concurrency. Contention-sensitive phases (5/6/11) require a real disposable PostgreSQL before acceptance.
- The Phase 4 plan's SQL was executed on disposable PGlite (76 checks) and the app probes on the real Express harness (9 checks); implementation tests are proposed, not yet written.
- Product vision statements derive from the approved architecture set; no functionality has been invented beyond it. Anything not evidenced in code is tagged B/C/D, never A.
- Historical security incidents remain open and owner-led; this specification neither closes nor investigates them.
