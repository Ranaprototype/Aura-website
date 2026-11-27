# AURA architecture — Phase 0

**Implemented today:** existing React/Vite SPA → same-origin Express API → optional Supabase PostgREST client → PostgreSQL. One Node process, no workers or microservices. The UI still uses its HOLO theme, catalog, configurators and local cart. These are design previews, not authoritative offers. Checkout, accounts and order lookup have explicit unavailable screens. A browser bookmark, URL or local profile is not an identity or purchase.

`server/index.ts` loads environment, validates it, constructs the database adapter and starts a loopback listener. `server/app.ts` composes middleware, module routers, API fallback, optional static SPA and safe errors. `server/modules/diagnostics.ts` owns diagnostics; `server/lib/supabase.ts` implements its narrow store interface. The router knows no Supabase credential. No runtime dependency on an admin client. `client/src/components/CommerceStatus.tsx` provides the shared status layout. No business-critical operation is delegated to the browser.

## Local boot (repository root)

Use Node 22.22.3 and Corepack with the pnpm version in `package.json`. `corepack pnpm install --frozen-lockfile --ignore-scripts`. In separate terminals run `corepack pnpm dev:api` (127.0.0.1:3001) and `corepack pnpm dev` (127.0.0.1:3000). Browse the latter; requests to `/api` are proxied, never addressed to a backend host in browser code. `PORT` changes the API port, not the UI port. Both tools use the same server setting: shell first, then repository `.env.local`, otherwise 3001. Mode-specific Vite env files do not select the API listener. Restart both after configuration changes. DB configuration is optional; without it, readiness is unavailable by design. For the built app run `corepack pnpm build` then `corepack pnpm start` from root. This is a local verification path, not deployment approval.

## Implemented through Phase 3 (branch only, awaiting review)

Phases 1 and 2 added scrypt identity, opaque hashed sessions, CSRF double-submit,
single-use email tokens, organizations/memberships/invitations, and RLS-backed
tenant isolation. Phase 3 adds the seller profile review workflow and the
product catalogue: `aura.seller_profiles`, `products`, `product_revisions`,
`product_variants`, `product_media`, `product_attribute_values`,
`category_attributes` and append-only `audit_events`, served by
`server/modules/marketplace/` and four new client screens (`/seller`,
`/seller/products`, `/seller/products/:id`, `/admin/review`). Only a product
whose latest submitted revision was approved by a platform administrator is
purchasable; price, inventory, checkout and manufacturing remain unimplemented.
See [the Phase 3 architecture](AURA-PHASE-3-ARCHITECTURE.md) and
[report](AURA-PHASE-3-REPORT.md). Nothing here is merged or deployed.

## Future contracts (ownership decisions, not implemented services)

- **Authentication, Users, Customers, Sellers, Manufacturers:** verified principal → scoped membership/capabilities. Each profile kind owns its data and visibility rules. Administration must use audited domain commands, not a privileged database shortcut.
- **Products, Categories, Inventory, Cart, Orders:** product definitions and taxonomy feed server quotes; inventory owns availability and reservations; orders commit immutable snapshots with inventory atomically. No cross-module table writes by frontend or external agents.
- **Payments, Refunds, Shipping:** fulfillment and financial transitions consume verified order state. Hosted checkout only; authenticated provider events and idempotency control settlement. Refunds and exceptional adjustments need approval.
- **AI Design, 3D Customization, Community, Product Lab:** versioned designs and consented sharing precede demand validation. Likes, suggestions and previews do not create commitments. Future automotive work must reuse verified design and manufacturing capabilities.
- **Manufacturing:** demand → authorized quote → approved production commitment. **Notifications** consume committed events. **AI Agents** request scoped actions; **Audit and Security** capture approvals/outcomes without sensitive payloads. Do not build these modules or tables before approved use cases.

Keep shared request contracts small; route → authorization → domain service → repository. Only introduce Redis for disposable caching/jobs if measured needs arise. PostgreSQL remains authoritative. No infrastructure, secret store, object storage, email, alerting or background system has been provisioned. Local, isolated tests, private staging and production must not share credentials or data. Staging and production need separate owner approval, access reviews, operational alerts, backup/restore evidence and rollback rehearsal.
