# Phase 3 architecture — seller management and product catalogue

Status: implemented on an isolated branch, **not merged**. This document describes
what exists in the working tree, the invariants it enforces and the decisions
that were deliberately deferred. It complements [AURA-PHASE-3-REPORT.md](AURA-PHASE-3-REPORT.md),
which records verification evidence, and the existing architecture set.

## Scope

In scope: seller profiles and business information, seller onboarding and
platform approval, organization-scoped seller permissions, a seller dashboard,
product CRUD (create, edit, archive), categories and typed attributes, product
media **references**, product variants, seller ownership with tenant isolation,
the draft → submitted → approved/rejected → archived lifecycle, platform review,
audit history, and the rule that nothing is purchasable without approval.

Out of scope and untouched: checkout, payments, refunds, shipping, AI generation,
3D customization, manufacturing, public storefront catalogue read APIs.

## Module layout (modular monolith)

```text
server/modules/marketplace/
  index.ts      composes the three routers and mounts them under /api/v1
  schemas.ts    strict zod contracts + database error mapping
  helpers.ts    tenant-scoped loaders, serializers, PRODUCT_SELECT, audit writer
  seller.ts     seller dashboard, profile read/save/submit
  catalog.ts    categories, product CRUD, submit/archive, variants, media, attributes
  review.ts     platform seller queue, platform product queue, approve/reject
```

Everything reuses `authorized()` from `server/modules/authorized.ts`. There is no
new authentication mechanism, no second database client, no service split, and
no route that bypasses the session, CSRF, origin or organization checks. The
origin allowlist and double-submit cookie are mounted for the whole `/api/v1`
surface; each route additionally verifies the session-bound CSRF token.

`shared/marketplace.ts` holds statuses, role sets and view types. It contains no
authorization logic: the server never imports role decisions from a browser
bundle, and the browser never infers permission from a status.

## Data model

| Table | Purpose | Tenant key |
|---|---|---|
| `aura.seller_profiles` | one application per organization; business identity and review state | `org_id` (PK) |
| `aura.categories` | global reference data (seeded: sneakers, apparel, accessories) | — |
| `aura.category_attributes` | typed attribute definitions per category | — |
| `aura.products` | seller-owned listing with lifecycle state | `org_id` |
| `aura.product_revisions` | immutable submitted snapshots, numbered per product | `org_id` |
| `aura.product_variants` | size/colour/material combinations, seller-defined SKU | `org_id` |
| `aura.product_media` | ordered external https image references and alt text | `org_id` |
| `aura.product_attribute_values` | one validated value per declared category attribute | `org_id` |
| `aura.audit_events` | append-only seller and product history | `org_id` |

Design choices worth stating:

- **No price, currency, stock or manufacturing field exists anywhere.** Creating
  one would imply a commercial commitment this phase has not designed.
- **Media are references, not uploads.** A URL must be absolute `https`, contain
  no whitespace and be at most 900 characters; images must additionally end in
  `.png/.jpg/.jpeg/.webp/.avif/.gif`. Nothing is fetched server-side, so there is
  no SSRF surface and no storage bucket to configure.
- **Category is immutable after creation** (`products_guard` rejects a change),
  because attribute declarations are category-scoped and a silent recategorize
  would orphan validated values.
- **Variants and media are hard-deleted** (they are catalogue detail, fully
  re-addable and captured in snapshots); **products are archived, never deleted**.
- **Child rows follow the product lifecycle.** `catalogue_child_guard` locks the
  parent row and refuses variant/media/attribute changes while the product is
  `submitted` or `archived`. On an approved product the same change sets
  `pending_changes`, withdrawing purchasability and writing a `product.revised`
  audit event, so catalogue content cannot silently diverge from the revision a
  reviewer approved.
- **Audit rows are append-only** for every runtime role: a trigger rejects
  `UPDATE` and `DELETE` even for the table owner.
- **Slugs are unique per organization**, lower-case `[a-z0-9-]`, 1–80 chars. An
  omitted slug is derived from the title with a base-36 time suffix.
- A seller profile is **global to the organization**, not per user. The sender's
  organization is resolved from `x-aura-org` plus a live membership row; the
  browser never supplies a seller or organization identity that is trusted.

## Lifecycle

```text
seller:  (none) --create--> draft --submit--> submitted --approve--> approved
                             ^                    |                     |
                             |                    +--reject--> rejected |
                             +----resubmit----------------------------+
approved --(seller edits content)--> approved with pending revision, purchasable = false
approved|rejected --archive--> archived (read-only; pending_changes = false)
```

| Transition | Actor | Preconditions enforced in SQL |
|---|---|---|
| profile draft → submitted | catalog writer, verified email | `status='draft'`, complete business fields |
| profile submitted → approved | platform admin | `status='submitted'`, `reviewed_by` recorded |
| profile submitted → rejected | platform admin | `status='submitted'`, rejection note non-empty |
| product create → draft | catalog writer | approved seller profile in same org |
| draft/rejected → submitted | catalog writer | product status in (`draft`,`rejected`,`approved`), ≥1 variant, ≥1 image, all required attributes |
| submitted → approved | platform admin | pending revision exists; product row gets `approved_revision_id`, `approved_at` and `pending_changes=false`, which is what makes it purchasable |
| submitted → rejected | platform admin | pending revision exists; note stored on the revision |
| any editable → archived | catalog manager (owner/admin) | not already archived; clears pending state. Archiving is irreversible, so it is reserved to the roles that can also submit the seller profile |
| editing approved content (row, variant, media or attribute) | catalog writer | `pending_changes=true`, which withdraws purchasability |
| child content change while submitted/archived | nobody | `product_locked` |

`submitted_at`, `archived_at` and `approved_at`/`approved_revision_id` cannot be
written by a non-platform-admin update path; the guard raises `forbidden`
(`42501`) rather than trusting the caller.

### Purchasability

A product is purchasable **only** when all of the following hold. There is no
stored `purchasable` column; the predicate is derived from durable state so it
cannot drift:

1. `products.status = 'approved'`
2. `products.pending_changes = false`
3. `products.approved_revision_id` points at a revision whose decision is
   `approved` and which belongs to the same product and organization
4. the organization's seller profile is `approved`

Conditions 1–3 are enforced by `products_guard`; condition 4 is checked by the
shared `isPurchasable()` predicate and encoded in the projection. Any content
edit — including a variant, media or attribute change through the child tables —
sets `pending_changes` in the same transaction (see `catalogue_child_guard`), so
the predicate immediately becomes false. `aura.storefront_products` is a
`security_invoker` view that expresses the same rule (including the approved-
seller join) and is the only consumer-facing projection; it is not exposed over
HTTP in this phase.

## Roles and authorization

Existing organization roles are reused. Two new shared sets:

- `CATALOG_WRITE_ROLES = ('owner','admin','member')` — create/edit products,
  variants, media, attributes; submit for review. (`member` is the organization's
  standard editing role; there is no `editor` role in this product.)
- `CATALOG_MANAGE_ROLES = ('owner','admin')` — save and submit the seller profile.

| Capability | viewer | member | admin | owner | platform admin |
|---|---|---|---|---|---|
| Read seller dashboard/products | yes | yes | yes | yes | yes (review routes) |
| Create/edit products, variants, media, attributes, submit | no | yes | yes | yes | no (org write paths refuse) |
| Archive a product (irreversible) | no | no | yes | yes | no |
| Save/submit seller profile | no | no | yes | yes | no |
| Read audit history of own org | yes | yes | yes | yes | yes (via review) |
| Approve/reject sellers and products | no | no | no | no | yes |

Platform administration is a **separate** global grant (`aura.platform_admins`),
never a role inside an organization, and it cannot be created through the API.
Non-platform access to `/admin/*` returns `403 role_forbidden`, including a
seller attempting to review their own submission. Every approval or rejection
decision is written to the audit trail with the reviewer's identity.

## Tenant isolation

Six independent layers, each tested:

1. `x-aura-org` is validated against `aura.memberships` for the session's
   principal, inside the request transaction, with the active `aura_app` role.
2. Every seller-facing query filters `org_id` explicitly in addition to RLS —
   including product lookups by id and the `UPDATE`/`DELETE` statements that
   follow them. Only the platform review path omits the filter, and it is gated
   by the platform grant.
3. RLS policies on every tenant table use `aura.current_org_id()` and
   `aura.is_active_member(org_id)`; the site also checks the caller's role.
4. Composite foreign keys carry `org_id`, so a variant, media item, attribute
   value or revision cannot reference a product in another tenant even if a bug
   skipped the filter.
5. Reference-data writes are not granted at all to `aura_app`; only `SELECT`.
6. Tenant identity is never read from a request body or a client-supplied seller
   id; `POST /seller/products` derives `org_id` and `seller_id` from the
   authenticated session and the organization's profile row.

## API surface

All routes are mounted below `/api/v1`, require a session and a verified email,
require the CSRF header on mutations, and use strict JSON (32 kB cap, unknown
fields rejected).

| Method and path | Purpose |
|---|---|
| `GET /seller/dashboard` | profile, counts by status, recent activity |
| `GET /seller/profile` | profile plus audit history |
| `PUT /seller/profile` | create or save the application (manage roles) |
| `POST /seller/profile/submit` | submit for platform review |
| `GET /categories` | categories with typed attribute definitions |
| `GET /seller/products` | own catalogue, filterable by status |
| `POST /seller/products` | create a draft |
| `GET /seller/products/:id` | detail, working copy, latest revision, variants, media, attributes, audit |
| `PATCH /seller/products/:id` | edit working copy (blocked while submitted or archived) |
| `POST /seller/products/:id/submit` | freeze a revision and request review |
| `POST /seller/products/:id/archive` | archive and make non-purchasable |
| `POST/PATCH/DELETE /seller/products/:id/variants[/:variantId]` | variant CRUD |
| `POST/PATCH/DELETE /seller/products/:id/media[/:mediaId]` | media reference CRUD |
| `PUT /seller/products/:id/attributes` | replace validated attribute values |
| `GET /admin/sellers`, `GET /admin/sellers/:orgId` | seller queues and detail |
| `POST /admin/sellers/:orgId/approve`, `.../reject` | seller decisions |
| `GET /admin/products`, `GET /admin/products/:id` | product queues and snapshots |
| `POST /admin/products/:id/approve`, `.../reject` | product decisions |

Error codes are stable and machine-readable: `seller_profile_required`,
`seller_not_approved`, `seller_already_submitted`, `product_incomplete`,
`product_locked`, `product_archived`, `product_already_submitted`, `sku_exists`,
`slug_exists`, `revision_required`, `invalid_attribute_value`, plus the Phase 2
codes (`authentication_required`, `verified_email_required`,
`organization_required`, `organization_forbidden`, `role_forbidden`,
`csrf_failed`, `invalid_request`, `payload_too_large`).

## Frontend surfaces

- `/seller` — organization selector, profile form, review status, submission,
  dashboard statistics, audit activity.
- `/seller/products` — status-filtered list, draft creation.
- `/seller/products/:id` — working-copy editor, lifecycle actions, variants,
  media, category attributes, revision history, audit.
- `/admin/review` — seller queue and product queue, submitted-snapshot viewer,
  approve/reject with a mandatory rejection note.

The pages use the existing HOLO tokens and components. The only CSS added
is an additive `market-*` block at the end of `client/src/index.css`; no existing
selector, token or storefront component was modified. The organization selector
is a convenience that sets `x-aura-org`; it is not an authorization input.

## Deliberate non-goals for this phase

- Withdrawal of a submitted product (the seller can archive instead).
- Partial updates of attributes (whole-set replacement only).
- Server-side media ingestion, transformations or virus scanning (references only).
- Public catalogue APIs, search and storefront product detail routes.
- Prices, inventory, currencies, discounts, shipping profiles, manufacturing data.
- Pagination cursors beyond a bounded `limit`; expected volume is small.
- Seller profile edits are not versioned; each save is audited instead.
