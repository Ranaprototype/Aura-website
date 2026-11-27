# AURA Complete Development Roadmap

**Status:** authoritative phase plan · planning baseline `master` = `b12a5596bf3b454b844c5d3b5bc83784247e300f` (Phases 0–3 merged via PRs #1–#4, verified 2026-11-27).
**Controls:** phase sequence, scope, dependencies and acceptance criteria. Product requirements live in [AURA-MASTER-SPECIFICATION.md](AURA-MASTER-SPECIFICATION.md); process in [AURA-AGENT-OPERATING-RULES.md](AURA-AGENT-OPERATING-RULES.md); Phase 4 technical design in [AURA-PHASE-4-PLAN.md](AURA-PHASE-4-PLAN.md). Decision IDs (D-xx) refer to the single register in the master specification §19.

## Completed foundation (do not rebuild)

| Phase | Delivered | Merge commit |
| --- | --- | --- |
| 0 | Security containment (no card capture, no fake orders/accounts), modular Express foundation, safe diagnostics, CI gate, baseline tests | `21f728190e07dc9a9442814d45523265f74e097d` (PR #1) |
| 1 | Architecture set + ADRs (documentation only) | `fd1edeede19e9edbb48f08e2b060165933ced974` (PR #2) |
| 2 | Identity, sessions, CSRF/origin, organizations/memberships/invitations, RLS tenancy, email, verification suites | `5d30260b75eead686b27be4d0f0fd366b74d4555` (PR #3) |
| 3 | Seller onboarding/review, catalogue lifecycle, immutable revisions, variants/media-references/attributes, audit, four-eyes, storefront projection (not public) | `b12a5596bf3b454b844c5d3b5bc83784247e300f` (PR #4) |

Baseline verification (executed 2026-11-27): `pnpm check` clean; **18 files / 294 tests pass**; build OK; **browser suite 3/3 pass, 0 skipped**; hosted CI green (run `45943762715`).

## Sequencing principles

- Combine closely related functionality when technically safe; never combine unrelated high-risk changes merely to shrink the phase count.
- Each phase is one isolated branch + PR, full regression suite green, owner authorization before commit/push/PR and explicit approval before merge (operating rules §workflow).
- Money, inventory and commitment invariants (Phases 5, 6, 11) require **real disposable PostgreSQL** concurrency tests before acceptance; PGlite alone is insufficient there.
- Deployment gates **G1/G2** are owner-controlled and sit between phases; no phase deploys itself.

```
4 → 5 → 6 → 7
        ↘
8 → 9 → 10
5,6,9 → 11 → 12
G1 (private staging) before Phase 6 sandbox-provider work
G2 (production) before any real customer traffic
```

---

## Phase 4 — Public marketplace storefront, global slugs, seller suspension

Full technical design: [AURA-PHASE-4-PLAN.md](AURA-PHASE-4-PLAN.md). **D-01–D-04 are owner-directed (2026-11-27 correction)** and reflected in the proposal. Remaining owner gates: **D-22** (implementation go-ahead, OPEN), the discovery UX choices **D-23/D-24/D-25** (search fields/semantics, sort options/default, filter facets — **proposed defaults recorded, awaiting explicit owner confirmation, NOT approved**), and **D-21** (public seller storefronts / seller disclosure, deferred to a later phase). Second review round corrections applied 2026-11-27; final-preparation revision adds the **[database ownership & migration prerequisites runbook](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md)** and executable ownership-procedure proofs (1.20–1.24). The owner makes one go/no-go decision after reviewing the package.

1. **Objective:** make the approved catalogue publicly readable (anonymous, read-only) with stable URLs, and give operators a state-preserving suspension tool — without introducing commerce.
2. **Features:** public product list/detail (minimum discovery fields, no seller identity) with **search (title+summary), category + attribute filtering, and selectable sorting (newest/title)** — owner-restored scope; UX menus gated by D-23/D-24/D-25; global slug uniqueness with deterministic collision migration + redirects; seller suspend/restore (four-eyes, audited); isolated anonymous DB role/pool; public rate limiting; signed cursor pagination; uniform public 404; no-store consistency fix; trusted-proxy config.
3. **Database:** **ownership prerequisite first** — create `aura_catalog_owner` (NOLOGIN/NOSUPERUSER/NOBYPASSRLS), transfer schema + catalog base tables, set up the migration executor (CREATEROLE + membership), per the [ownership procedure](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md); then additive migrations `0008_public_storefront.sql` (suspension overlay + guards + confidential-note accessor, `aura_public` role with **zero base-table grants**, role-targeted policies **with the full publication predicate (approved seller + no suspension) as defense-in-depth**, `ALTER POLICY … TO aura_app` scoping, **SECURITY DEFINER discovery views with explicit ownership reassignment to the non-superuser NOBYPASSRLS catalog owner (§8)**, `public_rate_limits`, `slug_redirects`) and `0009_global_product_slugs.sql` (backfill + global unique index) with a reviewed rollback. No edits to `0001`–`0007`.
4. **Backend:** new `server/modules/storefront/` (public GET router at `/api/v1/storefront/*`, separate public pool, cursor signer, public limiter); suspension routes `POST /api/v1/admin/sellers/:orgId/suspend|restore` reusing `requirePlatformAdmin`; config additions (`DATABASE_PUBLIC_URL`, `PUBLIC_CURSOR_SECRET`, `TRUST_PROXY`, `PUBLIC_READ_IP_LIMIT`); no-store mount-order fix.
5. **Frontend:** additive `/marketplace` and `/marketplace/product/:slug` pages reusing HOLO tokens/components (no public seller page, D-21); `shared/routes.ts` allowlist extension; suspension controls on `/admin/review`; preview configurators untouched.
6. **Security:** least-privilege public role (no identity-table access, no helper EXECUTE, zero base-table grants, slug-keyed definer discovery views owned by the non-superuser NOBYPASSRLS catalog owner), complete defense-in-depth public policies (approved seller + no suspension), fail-closed when public DB unconfigured, no existence oracle, CSRF/origin unchanged for mutations, rate-limit isolation, signed cursors bound to route/search/filters/sort/limit, trusted-proxy default off.
7. **Dependencies:** Phases 0–3 only. No provider, no storage, no payment.
8. **Automated tests:** migration replay + catalog assertions; public-role RLS/grant matrix; suspension lifecycle/four-eyes/freeze/restore; slug backfill/rollback/drift; limiter isolation; cursor tamper/mismatch/coverage; discovery search/filter/sort; API contract (uniform 404, no-store, pagination); config fail-closed matrix. (Design validated pre-implementation: **97 SQL checks + 16 cursor checks + 9 app probes + 3 browser baseline**, `validation/phase-4/results/`.)
9. **Browser tests:** anonymous browse → detail; suspended seller's products disappear; preview configurator/cart/checkout containment regression; admin suspend/restore flow.
10. **Acceptance criteria:** all automated + browser suites green in hosted CI; public reads work with zero cookies; private columns unreachable at the DB layer; suspension preserves and restores exact prior state; slug migration reversible; no commerce endpoint added; full 294+ baseline regression preserved.
11. **Exclusions:** prices, cart/checkout for marketplace items, payments, inventory, **semantic/vector search and dedicated search-index infrastructure** (basic discovery search/filter/sort is in scope), uploads/CDN, seller slug renames (D-13), identity-level suspension, caching/CDN (D-05), **public seller storefronts and seller identity/disclosure fields (D-21, separate owner approval)**.
12. **Deliverables:** migrations + rollback, storefront module, two public pages + admin suspension UI, tests, updated docs, phase report with executed evidence.

## Phase 5 — Commercial catalogue: offers, inventory, server cart, orders

Owner gates: D-06 inputs (currency choice at least), D-20. **No payment settlement in this phase.**

1. **Objective:** turn approved listings into authoritative, server-priced offers with stock and order capture, so checkout can later attach a hosted payment provider without reworking invariants.
2. **Features:** versioned offers (amount + currency minor units, validity), per-seller/location inventory balances + expiring holds, server cart, repriced quote with explicit customer re-acceptance, checkout intent, order + vendor-scoped suborders with immutable snapshots, customer order history (read), seller order queue (own allocation only). Orders created `awaiting_payment`; expiry releases holds.
3. **Database:** `offers`, `inventory_balances`, `inventory_movements`, `inventory_holds`, `carts/cart_lines`, `quotes`, `orders/suborders/order_lines`, `idempotency_keys`, `outbox`. Composite tenant FKs; integer minor units + currency; guarded conditional stock updates; partial indexes for holds/expiry/outbox.
4. **Backend:** `modules/commerce/` (catalog-offers, inventory, cart, checkout, orders) using the existing `authorized()` transaction; reservation + order + outbox commit atomically; idempotency keys on sensitive POSTs; no cross-module table writes.
5. **Frontend:** marketplace "add to cart" (real cart), server-cart page replacing preview cart **only for marketplace items** (preview cart behaviour preserved for preview items until owner-approved migration), checkout review page (no payment fields), order history pages, seller order queue.
6. **Security:** server-side pricing only; client totals untrusted; tenant-scoped order reads; hold/stock contention tests; quote expiry + re-consent on changed terms; rate limits on cart/checkout.
7. **Dependencies:** Phase 4 (public catalogue), Phase 2/3 identity + approval.
8. **Automated tests:** reservation atomicity under **real PostgreSQL concurrency** (last-unit race, cancel-vs-checkout), repricing consent, idempotent replay, hold expiry, cross-vendor isolation, outbox dedupe.
9. **Browser tests:** browse → add → cart → quote → order (awaiting payment) → history; changed-price re-consent; empty/oversell paths.
10. **Acceptance:** no oversell under concurrent load; order snapshots immutable; vendor sees only its allocation; every money value integer minor units + currency; full regression green.
11. **Exclusions:** payment capture/refunds (Phase 6), shipping labels/carriers (Phase 7), manufacturing, discounts/promotions engine (owner decision later), multi-currency conversion.
12. **Deliverables:** commerce migrations/module/UI, concurrency test evidence on real PG, phase report.

## Phase 6 — Hosted payments, refunds, reconciliation, order notifications

Owner gates: **D-06 (hard)**, G1 staging.

1. **Objective:** settle orders through a provider-hosted checkout with verified events, and operate refunds safely.
2. **Features:** checkout session creation (stable provider key), signature-verified webhook inbox, settlement state machine, reconciliation of uncertain/missing events via authenticated provider reads, refund request → human approval → provider refund (cumulative ≤ captured), customer/seller order notifications (email + in-app feed built on outbox).
3. **Database:** `payment_intents`, `provider_events` (unique provider/account/event), `refunds/refund_approvals`, `notifications/delivery_attempts`; outbox consumers.
4. **Backend:** `modules/payments/`, provider adapter (wire-status/shape/semantic validation), separate webhook ingress `/integrations/payments/:provider/webhook` (raw-body signature before parse), `modules/notifications/` + leased worker from the same codebase.
5. **Frontend:** redirect-to-hosted-checkout flow, payment status pages (never confirm from redirect), refund request UI, notification center.
6. **Security:** no PAN/expiry/CVC anywhere; forged/stale/duplicate/mismatched events cannot mark paid; refund approval separated from settlement (four-eyes for privileged refunds); secrets server-side; sandbox provider only until G2.
7. **Dependencies:** Phase 5; D-06; G1.
8. **Automated tests:** event forgery/replay/out-of-order/duplicate, partial-refund ceiling under concurrency, reconciliation paths, notification idempotency, worker lease/retry/dead-letter.
9. **Browser tests:** sandbox checkout success/failure/cancel, refund request flow, notification feed.
10. **Acceptance:** duplicate events never double-settle; refunds never exceed captured; uncertain outcomes reconcile, never auto-success; full regression green.
11. **Exclusions:** card capture, payouts/seller settlement identity (owner decision), disputes automation, tax engine, carriers.
12. **Deliverables:** payments/notifications modules + adapter, webhook inbox, worker, sandbox evidence, phase report.

## Phase 7 — Fulfillment, shipping and returns logistics

1. **Objective:** move paid orders through seller-scoped fulfillment to delivery and returns.
2. **Features:** packages + line allocations, shipment intents, carrier label/tracking adapters (deduplicated carrier events), delivery confirmation, returns authorization + logistics, customer tracking UI, seller fulfillment queue.
3. **Database:** `packages/package_lines`, `shipments`, `carrier_events` (unique provider/account/event), `returns/return_lines`.
4. **Backend:** `modules/fulfillment/`; carrier adapters; outbox-driven label requests; no provider call inside a DB transaction.
5. **Frontend:** tracking pages, seller pack/ship UI, returns flow.
6. **Security:** vendor sees only its allocation + necessary fulfillment details; carrier webhook verification; address data minimized and access-scoped; out-of-order events cannot reverse delivery without reviewed correction.
7. **Dependencies:** Phases 5–6.
8. **Automated tests:** allocation uniqueness, duplicate/out-of-order carrier events, returns state machine, address-scoping.
9. **Browser tests:** ship → track → deliver → return journey (sandbox carrier).
10. **Acceptance:** a label is not delivery; allocations never duplicate; returns reconcile with refund policy; regression green.
11. **Exclusions:** manufacturing QA release (Phase 12), international customs automation, carrier marketplace.
12. **Deliverables:** fulfillment module + adapters + UI, phase report.

## Phase 8 — Asset platform and AI design studio

Owner gates: **D-07, D-08 (hard)**.

1. **Objective:** let users generate and edit designs with AI on a private, versioned asset platform with hard budgets.
2. **Features:** upload intents (server-chosen private keys, quarantine, allowlisted types, size/pixel limits, scan before visibility), design + immutable revisions with parentage/provenance, generation/edit jobs (prompt-template + model versions, budget reservation, concurrency caps), draft outputs, job status UI, scoped agent action-request framework (proposal-only).
3. **Database:** `assets`, `designs/design_revisions`, `design_jobs`, `budgets/usage`, `agent_action_requests`, outbox job tables.
4. **Backend:** `modules/assets/`, `modules/design/`, model adapters (capability-bound), leased workers; spend ceilings enforced before dispatch; outputs validated/scanned as untrusted.
5. **Frontend:** studio (brief → generate → edit → revisions), asset library, job status, budget indicators.
6. **Security:** private-by-default storage; signed short-lived URLs never logged; owner-scoped retrieval; no private content to providers without consent/approved terms; per-user/org budgets; prompt/output treated as untrusted; no autonomous authorization.
7. **Dependencies:** Phase 2 identity; D-07/D-08; worker infrastructure from Phase 6.
8. **Automated tests:** upload authorization/quarantine/scan, revision immutability, budget exhaustion refusal, job dedupe/retry, retrieval scoping, provider-outage degradation.
9. **Browser tests:** generate → edit → revision history → private library; unauthorized asset access denied.
10. **Acceptance:** no private asset reachable without grant; budgets cannot be exceeded; revisions immutable; regression green.
11. **Exclusions:** community publication (Phase 10), 3D engine (Phase 9), vector search, autonomous agents.
12. **Deliverables:** assets/design modules + workers + studio UI, provider sandbox evidence, phase report.

## Phase 9 — 3D customization and specification validation

1. **Objective:** turn designs into validated, versioned customization specifications that manufacturing can later review.
2. **Features:** option-schema/geometry version pinning, parameter constraint + unit validation, compatibility rules, customization sessions referencing variant + design revision, specification snapshots with validation evidence, bridge from the HOLO configurators to real revisions (one approved use case at a time; previews preserved until replaced).
3. **Database:** `option_schemas`, `customizations/customization_revisions`, `spec_validations`.
4. **Backend:** `modules/customization/`; validation service; no geometry processing inside DB transactions.
5. **Frontend:** real configurator state backed by server revisions (starting with one silhouette), spec summary/validation UI.
6. **Security:** parameters validated against pinned schemas; object keys never authoritative; visual fit ≠ feasibility; tenant/owner scoping of customizations.
7. **Dependencies:** Phase 8; D-01 follow-up for preview migration.
8. **Automated tests:** constraint/unit validation, schema-version pinning, incompatible-option refusal, revision parentage.
9. **Browser tests:** customize → validate → save revision → reload; invalid combinations refused.
10. **Acceptance:** a saved spec pins exact versions and passes validation; previews still work; regression green.
11. **Exclusions:** manufacturer feasibility (Phase 11), automotive constraints, physics simulation.
12. **Deliverables:** customization module + engine integration + UI, phase report.

## Phase 10 — Community, creator ecosystem, Product Lab, demand intelligence

Owner gates: privacy/consent within D-10; D-07 for clustering.

1. **Objective:** let creators publish authorized design revisions, engage safely, and surface aggregate demand without creating commitments.
2. **Features:** public profiles (separate projection), publication with explicit consent, moderated comments, likes/private saves, takedown with delivery/index invalidation, Product Lab proposals/discussions, versioned demand clusters (aggregate, methodology + uncertainty recorded).
3. **Database:** `publications`, `comments`, `likes/saves`, `lab_proposals`, `demand_clusters/cluster_runs`.
4. **Backend:** `modules/community/`, `modules/lab/`, `modules/demand/`; moderation commands; scope-before-retrieval search.
5. **Frontend:** creator profiles, feed/publication pages, comments/likes/saves, Lab proposal flows, demand insights (aggregate only).
6. **Security:** publication consent; private drafts never surface in others' retrieval/CDN/logs; moderation rate limits; takedown revokes derived access; social counts confer no rights.
7. **Dependencies:** Phases 8–9.
8. **Automated tests:** consent gating, cross-user leakage, takedown invalidation, like/save uniqueness, cluster aggregations never expose raw cross-tenant signals.
9. **Browser tests:** publish → comment → like → save → takedown; Lab proposal journey.
10. **Acceptance:** private content unreachable after takedown; no commitment created by social actions; regression green.
11. **Exclusions:** campaign conversion (Phase 11), follows/notifications beyond existing feed, monetization.
12. **Deliverables:** community/lab/demand modules + UI, phase report.

## Phase 11 — Collective manufacturing: verification, quotes, campaigns, commitments

Owner gates: **D-11 (hard)**.

1. **Objective:** let verified manufacturers review exact specs, quote, and run threshold campaigns funded by explicit commitments.
2. **Features:** manufacturer onboarding + human verification (distinct from seller approval), project-scoped spec invitations, feasibility decisions, versioned quotes (bands/currency/capacity/expiry), campaigns pinning quote + terms + threshold + deadline, customer commitments with consent receipts, serialized close/cancel, below-threshold lapse + reconciliation.
3. **Database:** `manufacturer_profiles/capabilities`, `feasibility_reviews`, `quotes/quote_versions`, `campaigns/campaign_terms`, `commitments/consent_receipts`, close results.
4. **Backend:** `modules/manufacturing/`; campaign lock + close serialization; commitment state machine; funding verification hooks (provider from Phase 6).
5. **Frontend:** manufacturer console, campaign pages, commitment flow with explicit terms assent, organizer close dashboard.
6. **Security:** human feasibility/quote signatures; AI never authorizes; immutable terms; cancel-vs-close race tests; manufacturer sees only invited specs; consent evidence bound to terms hash.
7. **Dependencies:** Phases 5–6 (money), 9 (specs); D-11.
8. **Automated tests:** last-unit/cancel-vs-close races on real PG, terms-change re-consent, below-threshold lapse/refund reconciliation, duplicate close prevention.
9. **Browser tests:** invite → review → quote → campaign → commit → close (success and lapse).
10. **Acceptance:** no production without successful close + authorized release; commitments never silently upgraded; regression green.
11. **Exclusions:** production execution (Phase 12), multi-manufacturer sourcing, secondary markets.
12. **Deliverables:** manufacturing module + consoles + campaign UI, legal-terms evidence, phase report.

## Phase 12 — Production, quality and manufacturing fulfillment

1. **Objective:** execute approved production with accountable quality gates and deliver released units.
2. **Features:** production orders → batches → milestones, QA evidence + independent release/hold, shipment allocation of released units to vendor order lines (bridging Phase 7), customer production status.
3. **Database:** `production_orders/batches`, `qa_reviews/releases`, `production_allocations` (unique per allocation).
4. **Backend:** `modules/production/`; QA release authorization; allocation dedupe; outbox to fulfillment.
5. **Frontend:** manufacturer production board, QA console, customer production timeline.
6. **Security:** independent QA release (separation of duties); passing QA requires accountable evidence; no manufacturing action from social/model output.
7. **Dependencies:** Phase 11 (+7 for delivery).
8. **Automated tests:** allocation uniqueness, release/hold transitions, unauthorized QA refusal, milestone ordering.
9. **Browser tests:** produce → inspect → release → ship → deliver.
10. **Acceptance:** fulfillment follows QA release, never a generated image; allocations never duplicate; regression green.
11. **Exclusions:** automotive (future), factory IoT, automated QA vision.
12. **Deliverables:** production module + consoles, phase report.

## Deployment gates (owner-controlled, between phases)

- **G1 — Private staging** (before Phase 6 sandbox work): owner-approved isolated environment, separate credentials/data, sandbox providers, target-side migration-ledger + effective-grant + PostgREST-exposure verification, restore + rollback rehearsal, monitoring/alerting. (D-10)
- **G2 — Production** (before real customers): separate project/network/roles/keys, TLS everywhere, encrypted PITR backups + restore drill, RPO/RTO set, on-call/alert ownership, CSP after compatibility tests, provider live credentials approved, incident runbooks. No automatic promotion; human sign-off per release. (D-10, D-06)

## Future (unscheduled, no commitment)

- **Automotive customization:** reuses verified design/spec/manufacturing gates + specialist/safety approval; separate owner approval and regulatory review before any work.
- Advanced search/vector retrieval (only if justified by measured relevance needs), creator monetization, mobile apps, analytics/BI, multi-region.

## Cross-phase definition of done

Every phase: isolated branch from current master → approved scope only → focused tests during development → **full regression suite + browser suite green in hosted CI** → security review against the phase's threat list → defects fixed before reporting → phase report with executed evidence (commands, counts, engine, limits) → owner authorization for commit/push/PR → hosted CI verified → **explicit owner merge approval** → merge verified on master → only then the next phase. Never force-push, rewrite master, deploy or merge without authorization.
