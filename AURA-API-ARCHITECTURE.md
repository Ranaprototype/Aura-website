# API and processing architecture

**Current contract:** [Phase 0 API standards](AURA-API-STANDARDS.md). `server/app.ts` mounts `/api` before the SPA; only liveness, readiness (including `/api/health` alias) and restricted local diagnostic message routes exist. API misses return JSON 404, not HTML. Domain APIs below are **proposed names and contracts**, not callable features. Keep existing diagnostics unversioned; additive business contracts start at `/api/v1`. Do not retrofit clients to fictional endpoints.

## Request path

Ingress sets trusted request ID and enforces TLS/size/time limits → verify session and origin/CSRF for browser mutations → parse strict versioned DTO → resolve acting org and resource from authoritative records → authorize capability and state → domain command → repository within transaction → commit → response. Listing queries must scope the query itself, not filter unauthorized rows after pagination. Never infer authorization from route prefix. Keep DTOs separate from SQL row shapes and provider payloads. Each module owns its command/query interface, errors, policy and repository; orchestration can pass a common transaction across module interfaces without importing their tables.

| Proposed `/api/v1` routes (examples)                                                                       | Caller and enforcement                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/session`, `/me/profile`, `/me/addresses`, `/organizations/:id/members`                                   | Verified identity, self-only private profile; scoped org admins for memberships; no self-escalation. IdP redirects/callbacks verified separately.                                                        |
| `/catalog/products`, `/listings`, `/seller/listings`, `/seller/inventory/reservations`                     | Public approved projections only; seller mutations require specific active seller membership and variant/location ownership. Reservation commands may be internal only.                                  |
| `/me/cart`, `/checkout/intents`, `/orders/:id`, `/payments/checkout-sessions`, `/refund-requests`          | Customer reaccepts server quote; buyer or tightly scoped vendor suborder read. Sensitive actions require authorization, idempotency, verified state and recorded consent. No raw payment input endpoint. |
| `/designs/:id/revisions`, `/design-jobs`, `/customizations`, `/assets/upload-intents`                      | Owner/delegate with explicit edit/read scope; quotas, scan and provenance checks. Validate parameters against pinned schema; never accept object key as authority.                                       |
| `/publications`, `/publications/:id/comments`, `/likes`, `/me/saves`, `/lab/proposals`, `/demand/clusters` | Publication consent, moderation and visibility; private saves self-only. Restricted aggregates for analysts, never raw cross-tenant signals.                                                             |
| `/manufacturer/reviews`, `/manufacturer/quotes`, `/campaigns/:id`, `/campaigns/:id/commitments`            | Verified manufacturer and project invitation for review/quote. Organizer pins approved terms. Customers submit/cancel only their own commitments subject to current rules.                               |
| `/production/batches`, `/quality/reviews`, `/shipments`                                                    | Assigned manufacturer updates progress; independent authorized QA release; vendor/carrier-specific fulfillment scope. No manufacturing action from social or model output.                               |
| `/agent/action-requests`, `/admin/cases`, `/approvals/:id/decisions`, `/jobs/:id`                          | Delegated proposal vs human decision; audit and separation of duties. Job status/results authorized per owner, not simply possession of job UUID.                                                        |

Provider callbacks use a **separate** ingress such as `/integrations/payments/:provider/webhook`, not a browser session. Map allowlisted provider/account to an adapter; verify raw request signature/timestamp **before** parsing or writing. Validate event shape and binding to merchant, environment, order, currency and amount. Commit deduplicated inbox receipt before acknowledgment; reconcile independent trusted provider query for uncertain or conflicting outcomes. No arbitrary callback URLs supplied by agents/users.

## Contracts and concurrency

- JSON allowlists: reject unknown fields, excessive nesting/length and invalid enums/IDs. Return 200/201 only with validated representation, 202 with authorized job reference **only after durable enqueue**, 204 for successful empty mutation. For new v1 errors propose `{error:{code,message,requestId}}`; no schema/provider stack or sensitive payload. Keep Phase 0's flat error shape on its existing routes. Use 400/415 for invalid input/media, 401 for missing/expired identity, 403 or consistent 404 for inaccessible private objects, 409 for version/idempotency conflicts, 429 with retry guidance, 503 for unavailable upstreams. Never translate timeout to success or confirmed absence.
- Cursor pagination bounded by limit, stable sort plus ID; allowlist filters, include scope in cursor. Avoid totals that reveal private collections. Immutable revision or ETag/If-Match on mutable resources; stale proposal/quote returns conflict and requires renewed consent. Prefer additive fields; breaking changes need parallel version, usage measurement and retirement notice.
- Sensitive POSTs require an idempotency key scoped to actor/org + command, request digest, unique constraint and stored outcome. Same key+digest returns the previous authorized result; different digest → conflict. Concurrent duplicate waits or returns in-progress reference. Persist business mutation, key and outbox atomically. Propagate stable provider key, but provider and database are **not** a distributed transaction. On unknown outcome query/reconcile before retry. Business unique constraints (one campaign close, one allocation/refund) survive expiry of HTTP keys.
- Rate limits at ingress (IP/route) plus domain budgets (principal, org, provider). Bound page size, upload bytes, queued jobs, concurrent generation and daily cost. Avoid account enumeration. Design fail-safe behavior for quota-store outage; never allow unlimited paid calls. Set numerical limits only after threat/usage review.

## Transaction versus asynchronous work

| Synchronous atomic boundary                                        | After commit / failure handling                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reprice accepted cart, reserve stock, create pending order, outbox | Create hosted session with stable key; if provider unavailable report pending/unavailable, expire hold by policy. Verified payment changes order state in a new transaction.   |
| Record refund approval and reserve refundable balance              | Worker calls provider once per business key. Only verified result finalizes; uncertain refunds go to reconciliation.                                                           |
| Record exact terms, eligibility and commitment under campaign lock | Notifications, deadline close and production scheduling read committed records. Recheck threshold/funding and approvals, deduplicate close/allocations.                        |
| Persist authorized revision/job, quota reservation, outbox         | Scan/transform assets, generate image/variation, cluster demand, prepare recommendations. Save validated output as a draft or rejected artifact, settle usage even on failure. |
| Record QA release or authorized shipment intent                    | Request carrier label and ingest deduplicated tracking; out-of-order messages cannot reverse delivery without reviewed correction.                                             |

Workers claim limited batches under leased locks, release DB connection before external calls, renew lease for long jobs and commit result with expected version. Assume at-least-once delivery. Use backoff+jitter, bounded attempts, terminal failure/dead-letter review, deduplicated consumers and audited human replay. Version event payloads (`DesignRevisionPublished.v1`, `CampaignClosed.v1`); include identifiers, actor scope, event ID and trace ID, not PII. Revoked permissions or expired approvals at execution cancel the action. Real-time UI may poll status; unnecessary streaming infrastructure is deferred.

## Files, integrations and operations

Issue upload intent for approved type/size and tenant, allocate server-chosen private quarantine key, expire signed grant; verify checksum, decoded type and scan result before promotion. Serve only authorized revisions via short-lived signed GET. Never trust uploaded URL, file extension or claimed dimensions. Provider adapters validate wire status, media type, shape and semantic match before acknowledging success (as the diagnostics adapter now does). Bound retries/timeouts by operation; distinguish provider outage, permanent rejection and uncertain completion. Protect secrets server-side. Record redacted correlation IDs, latency, status classes, transition counts and queue lag; alert on duplicate spikes, stuck outbox and financial mismatches. See [security boundaries](AURA-SECURITY-ARCHITECTURE.md).

## Phase 3 seller and catalogue routes (implemented)

These routes exist in `server/modules/marketplace/` and are mounted at `/api/v1`
after session attachment. Every one requires an authenticated session with a
verified email; mutations additionally require the CSRF header and an allowed
origin. Organization scope comes only from `x-aura-org` validated against a live
membership row inside the request transaction — no body field, path parameter or
token claim can change the tenant.

| Route                                                                | Authorization                                                 | Notes                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /seller/dashboard`, `GET /seller/profile`                       | any active member (viewer+)                                   | Profile plus append-only audit history                                                                                  |
| `PUT /seller/profile`, `POST /seller/profile/submit`                 | `CATALOG_MANAGE_ROLES` (owner/admin)                          | Strict body allowlist; `seller_already_submitted` is a conflict                                                         |
| `GET /categories`                                                    | any active member                                             | Global reference data with typed attribute definitions                                                                  |
| `GET/POST /seller/products`, `GET/PATCH /seller/products/:id`        | `CATALOG_WRITE_ROLES`                                         | List filter is allowlisted; products are never hard-deleted                                                             |
| `POST /seller/products/:id/submit`                                   | `CATALOG_WRITE_ROLES`                                         | Freezes a numbered revision and requests review                                                                         |
| `POST /seller/products/:id/archive`                                  | `CATALOG_MANAGE_ROLES`                                        | Irreversible; makes the product non-purchasable and clears pending state                                                |
| variants, media, attributes sub-routes                               | `CATALOG_WRITE_ROLES`                                         | Media accepts external `https` references only; attributes are replaced wholesale                                       |
| `GET /admin/sellers[/:orgId]`, `POST .../approve`, `POST .../reject` | platform administrator only, excluding their own organization | Rejection requires a non-empty note; self-review returns `403 review_separation_required`                               |
| `GET /admin/products[/:id]`, `POST .../approve`, `POST .../reject`   | platform administrator only, excluding their own organization | Detail returns the submitted snapshot, revision and audit history; self-review returns `403 review_separation_required` |

Design rules applied, consistent with the contracts above:

- **No client-trusted identity.** Seller, organization, product owner and role
  are all derived server-side. Possession of a product UUID grants nothing:
  every seller lookup and mutation carries an explicit `org_id` predicate in
  addition to the RLS policy.
- **Strict contracts.** zod objects reject unknown fields, bound every string,
  and validate slugs, SKUs, hex colours, media URLs and category attribute
  values. Request bodies are capped at 32 kB for this router.
- **Pagination.** List endpoints accept a bounded `limit` (default 100, maximum 200) and use a stable sort; there is no cursor yet. Confirm catalogue sizes
  before Phase 4.
- **Origin and CSRF.** The origin/`Sec-Fetch-Site` allowlist and double-submit
  cookie are mounted for all of `/api/v1`; each route also verifies the
  session-bound CSRF token.
- **Stable error codes.** Conflicts return `409` (`seller_not_approved`,
  `product_locked`, `product_already_submitted`, `sku_exists`, `slug_exists`,
  `revision_required`), validation `400` (`product_incomplete`,
  `invalid_attribute_value`, `invalid_request`), authorization `403`
  (`role_forbidden`, `organization_forbidden`, `csrf_failed`) and identity
  `401`. Messages never include SQL, stack traces or other tenants' data.
- **Transactional consistency.** The request transaction is threaded through
  every loader and mutation, so RLS context is bound to the same connection and
  audit rows commit or roll back with the change. Pool queries are never issued
  inside an open transaction.
- **Approval is server-side.** The API never accepts `purchasable`, `status`,
  `approved_at` or review metadata from a seller request; those fields are set
  by guarded database transitions after a platform decision.
- **Audit is written on every decision.** Seller and product decisions record
  actor, organization, entity, transition and note.

Phase 3 deliberately adds **no public catalogue, checkout, payment, shipping or
generation endpoint**.
