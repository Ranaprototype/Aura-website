# AURA Phase 1 report · Core Platform Architecture

**Disposition: documentation ready for review; no operational release or Phase 2 authorization.** The design covers the full discover → design → customize → share → validate demand → manufacture together → purchase journey. It does not represent those capabilities as already implemented.

## Baseline and discovery

Origin URL verified locally as `https://github.com/Ranaprototype/Aura-website.git`. Initial working tree clean on dedicated `arena/1b5d1b1f-aura-website`; `git rev-parse HEAD master` returned the approved `21f728190e07dc9a9442814d45523265f74e097d` for both. `git merge-base --is-ancestor` succeeded against both local refs. This confirms the checkout and ancestry; it is not a fresh inspection of remote infrastructure. Read Phase 0 audit, correction report, standards and historical security record against source rather than treating them as current operational evidence.

| Source inspected | Verified now / preserve | Constraint or unresolved risk |
|---|---|---|
| `client/src/App.tsx`, `pages`, `lib/catalog.ts`, `lib/cart.ts`, `components/ui`, `shared/routes.ts`, `vite.config.ts` | Existing React storefront, product and sneaker configurators, cart and wishlist are previews. Preserve routes, HOLO visual identity, accessible status pages and consistent preview calculation. | Catalog and local selections are not seller offers or fulfillment contracts. Hand-maintained route matchers and client-only data will need compatibility tests. Never import historical checkout/profile data into real records. |
| `CheckoutPage.tsx`, `OrderConfirmationPage.tsx`, `AccountPage.tsx` (under `client/src/pages`) | Explicit unavailable states, device-local wishlist, no verified account/payment from navigation. | No active user auth, commercial authorization, settlement or seller isolation to extend implicitly. Keep denials in place. |
| `server/index.ts`, `server/app.ts`, `server/config.ts`, `server/environment.ts`, `server/modules/diagnostics.ts`, `server/lib/supabase.ts` | Loopback Express app factory; validated config, liveness/readiness separation, restricted local operator diagnostics, bounded reads and verified upstream wire status/row shape. | Diagnostic token is not identity; key format is not proof of privilege. No business transaction layer, durable worker or production observability established. |
| `supabase/migrations/0001_hello.sql`, `tests/migration.test.ts`, `server/lib/supabase-types.ts` | Single tracked application migration for `public.hello`, UUID PK and creation timestamp. RLS enables unscoped select/insert policies. SQL fixture test distinguishes grants from policies; server type file is a placeholder. | No deployed ledger, actual grants, role owners, exposed schemas or direct PostgREST access verified. HTTP restriction cannot enforce DB isolation on an independently exposed target. |
| `.github/workflows/phase-0.yml`, `tests/`, `package.json`, `.env.example`, Phase 0 reports | Read-only PR verification, frozen install/check/test/build/Chromium/audit, local/test settings and diagnostic fixtures. Preserve regression gates. | No CD, shared DB verification or restore evidence. Phase 0 hosted verification was previously recorded in [run 44484406903](https://github.com/Ranaprototype/Aura-website/actions/runs/44484406903); this report does not claim a Phase 1 CI run. |

## Documents delivered

- [Platform](AURA-PLATFORM-ARCHITECTURE.md): current vs target, component diagram, twenty domain responsibilities, creation-to-fulfillment path, model/agent boundaries, environments and recovery.
- [Database](AURA-DATABASE-ARCHITECTURE.md): preserves Phase 0 findings and adds conceptual relationships, ownership, tenant-safe foreign keys, query paths, scoped roles/RLS, lifecycle, transactions and migration safety.
- [API](AURA-API-ARCHITECTURE.md): existing versus proposed endpoints, authorization and DTO conventions, deduplication, workers, upload and provider contracts.
- [Security](AURA-SECURITY-ARCHITECTURE.md): threat/control/evidence matrix, private design protection, human authorization, payment boundary and incident status.
- [Decision records](AURA-ARCHITECTURE-DECISIONS.md): ten recommendations with alternatives, trade-offs, costs, dependencies and decision owners.
- This report: evidence, scope, outstanding gates and sequencing. No application, configuration, dependency, workflow, SQL or historical report was changed.

## Proposed design and main failure cases

Keep one Node/Express modular monolith and one authoritative PostgreSQL database. Modules own their writes and expose authorized commands. Split buyer orders into vendor-scoped allocations. Pin immutable design, spec, quote and consent revisions. Enforce ownership and membership in the service and database, and never use a tenant ID supplied by the browser as proof of access. Use internal transactions for stock/commitment/financial invariants, durable outbox/inbox for external work and scoped adapters for AI, payment and fulfillment. Large assets are private objects with PG metadata/access control. Redis is optional and cannot own commitments or financial state.

Models may generate/edit/rank/cluster/assist, not invent business facts. A published design is not a manufacturable specification; human feasibility and marketplace approval are separate. Social interest is not binding consent. Provider timeouts, duplicate webhooks, expired stock holds, campaigns below threshold and revocation during background work all have explicit pending, rejection, release or reconciliation paths. Agents never authorize payments or refunds; customer consent and scoped human approvals precede sensitive execution. No card capture, live provider, real order, worker or new database object is enabled by these documents.

## Validation, open decisions and recommendation

Documentation-only scope: verify local provenance, compare the touched-file manifest with the six requested names, check relative links, review diagram/domain/API/DB terminology and run `git diff --check`. Application tests, builds, hosted CI, provider integrations and database migrations are not Phase 1 execution evidence. No connection to shared DB, provisioning, deployment, push or merge is required for this report.

**Still pending:** owner-approved target DB metadata and isolation verification; identity/session/provider selection; merchant model, tax, refund and commitment/cancellation law; privacy/retention and AI usage terms; monitoring, cost budgets and recovery drills. Prior checkout exposure and secret rotation remain separate open issues; new architecture cannot certify historical remediation.

**Recommended first Phase 2 review, not work started:** agree on an identity/org membership and tenant isolation slice. Before implementation, approve the role/permission matrix and an additive, isolated migration/test plan. Its acceptance should include same-tenant allow/cross-tenant deny, revocation with pooled connections, direct DB denial, no privilege escalation, trustworthy error paths and preservation of Phase 0 browser containment. Defer checkout, AI, campaigns and provider provisioning until their own gates. Stop for human architecture review.
