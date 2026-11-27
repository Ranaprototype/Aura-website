# AURA Phase 4 Technical Plan — Public Marketplace Storefront, Global Slugs, Seller Suspension

**Status:** planning and technical preparation complete · **implementation NOT started** · awaiting owner review of D-01…D-04 and authorization.
**Baseline:** `master` = `b12a5596bf3b454b844c5d3b5bc83784247e300f` (Phases 0–3 merged, PRs #1–#4), verified 2026-11-27.
**Provenance note:** no prior `AURA-PHASE-4-PLAN.md` exists in any commit, branch or PR (`git log --all -- AURA-PHASE-4-PLAN.md` is empty; `git ls-remote` shows only `master` and the four merged phase branches). This document is therefore the authoritative Phase 4 plan, reconstructed from the owner's 20-issue review list and the verified repository state. It does not pretend to edit a previous file.
**Controlling documents:** [AURA-MASTER-SPECIFICATION.md](AURA-MASTER-SPECIFICATION.md) (product + decision register) · [AURA-COMPLETE-ROADMAP.md](AURA-COMPLETE-ROADMAP.md) (scope) · [AURA-AGENT-OPERATING-RULES.md](AURA-AGENT-OPERATING-RULES.md) (process).

---

## 1. Scope

**In scope (read-only public marketplace + moderation tooling):**

- Anonymous public catalogue: product list and product detail (variants/media/attributes), minimum discovery fields only. **No public seller profile pages in Phase 4** (D-01/D-21).
- Globally unique product slugs with a deterministic collision migration, redirect storage/resolution and a reviewed rollback.
- Seller suspension/restoration: state-preserving, four-eyes, audited, with immediate de-publication.
- A dedicated least-privilege anonymous database role and connection pool.
- Public rate limiting isolated from auth rate limits; signed cursor pagination; trusted-proxy configuration; uniform public 404; `no-store` consistency fix.
- Additive HOLO frontend pages under a new namespace; suspension controls on the existing admin review screen.

**Explicit exclusions:** prices, currency, stock, cart/checkout for marketplace items, payments, refunds, shipping, manufacturing, search/indexing, media uploads/CDN, seller slug renames (D-13), identity-level suspension, public caching/CDN (D-05), any change to preview configurators, cart, wishlist or containment denials.

**Owner gates before implementation:** D-01 (URL scheme), D-02 (public field allowlist), D-03 (suspension semantics), D-04 (global slug policy). All four have validated recommended answers in the register; implementation is blocked until the owner answers.

## 2. Verified baseline (evidence, not claims)

| Fact | Evidence |
| --- | --- |
| Phases 0–3 merged; master `b12a559` | `git log --merges`: `21f7281` (#1), `fd1edee` (#2), `5d30260` (#3), `b12a559` (#4); `gh pr list` all MERGED |
| Typecheck clean; **18 files / 294 tests pass** (61.5 s); build OK; **browser 3/3 pass, 0 skipped** | executed `corepack pnpm check`, `corepack pnpm test`, `corepack pnpm build`, `corepack pnpm test:browser` on 2026-11-27 (browser via the documented sandbox NSS-library workaround; `validation/phase-4/results/browser-baseline.log`) |
| Hosted CI green on Phase 3 | GitHub Actions run `45943762715` (success) |
| Schema `aura`, migrations `0001`–`0007`; roles `aura_app`; RLS + guards + four-eyes | `supabase/migrations/*.sql`; `tests/migrations.test.ts` |
| Slug uniqueness is **per organization** today | `products_org_slug_key unique (org_id, slug)` (`0005`) |
| `storefront_products` is security-invoker, **not public**; no public endpoint | `0005`; executed probe A.6: `GET /api/v1/storefront/products` → `404 not_found` |
| `/products/:slug` renders the preview `GenericConfigurator` | `client/src/App.tsx`; `shared/routes.ts` |
| CSRF header is `x-csrf-token` (not `x-aura-csrf` as the Phase 2 report says) | `server/modules/authorized.ts` |
| **Defect:** `/api/v1` responses lack `Cache-Control: no-store` (middleware mounted after v1 routers) | `server/app.ts`; executed probe A.3 (`validation/phase-4/results/app-probe.log`) |
| No `trust proxy` configuration exists | `server/app.ts`, `server/config.ts` (grep) |

## 3. Target architecture

```
Browser (anonymous) ── GET /api/v1/storefront/* ──► Express (same origin)
   attachSession (no cookie → no DB hit) → csrfGuard (safe method passes)
   → storefront router → public rate limiter (public pool)
   → PUBLIC pool (aura_public_login → aura_public) → SECURITY DEFINER discovery views
       → zero base-table grants; the view WHERE is the publication predicate
Browser (admin) ── POST /api/v1/admin/sellers/:orgId/suspend|restore ──► requirePlatformAdmin
   → app pool (aura_app) → suspension guards + four-eyes + audit (existing transaction contract)
```

- **Two pools, two logins.** `DATABASE_URL` (existing, `aura_app`) for authenticated/admin work; `DATABASE_PUBLIC_URL` (new, `aura_public`) for anonymous reads and the public limiter. The public pool never binds `aura.principal_id`, never reaches identity tables, and has no write path except `aura.public_rate_limits`. Missing public config → `503 storefront_unavailable` (fail closed; **never** fall back to the app pool).
- **Public reads = SECURITY DEFINER discovery views, zero base-table grants (D-02 / T-02).** `aura_public` has no SELECT on any base table or column; the five projections (`public_products`, `public_product_variants`, `public_product_media`, `public_product_attributes`, `public_slug_redirects`) are owner-owned definer views (no `security_invoker`) that select only slug-keyed discovery columns and call no functions. Internal ids appear only inside view joins and are never selectable. Role-targeted base RLS policies remain as defense-in-depth. The Phase 3 `aura_app` projection `storefront_products` keeps `security_invoker` and its column list (adds the suspension filter); it is **not** granted to `aura_public`.
- **Module:** `server/modules/storefront/{index,public,cursor,limits,schemas}.ts`; admin suspension routes added to `server/modules/marketplace/review.ts` (reuse, no duplicate module).
- **Frontend:** additive `/marketplace` and `/marketplace/product/:slug` only (D-01 owner-directed). **No public seller storefront in Phase 4** (`/marketplace/seller/:id` deferred, D-21). Preview routes untouched.

### 3.1 API contract (all GET, anonymous, `no-store`)

| Route | Behaviour |
| --- | --- |
| `GET /api/v1/storefront/products?limit&cursor&category` | Published products, keyset pagination `(approved_at DESC, slug DESC)`, default limit 24, max 60; optional `category` (category slug) filter; returns `{items, nextCursor}`. Each item: `slug, title, summary, category {slug, name}, approvedAt, heroImage` (first `kind='image'` media url or null). **No internal ids, no seller fields** (D-02). |
| `GET /api/v1/storefront/products/:slug` | Published product detail: `slug, title, summary, description, approvedAt, category {slug, name}` + variants (`title, size, colour, material, position`) + media (images only: `kind, url, altText, position`) + attributes (`key, label, value`). **No internal ids, no seller identity/disclosure** (D-02). If the slug is a redirect of a published product, returns `200` with `canonicalSlug` and `redirectedFrom` (client replaces the URL). Every other case → uniform `404 {"error":"not_found"}`. |
| `POST /api/v1/admin/sellers/:orgId/suspend` | Platform admin, four-eyes, body `{note}` (1–1000 chars, required). Sets the overlay; audited `seller.suspended` (detail records `noteRecorded`, not the note text). |
| `POST /api/v1/admin/sellers/:orgId/restore` | Platform admin, four-eyes. Clears the overlay; audited `seller.restored`. |
| `GET /api/v1/seller/suspension` | **Authenticated**, seller owner/admin of the org or platform admin only. Returns `{suspendedAt, note}` via `aura.seller_suspension_note(org)`; ordinary members get `403 role_forbidden` (D-03). The existing seller dashboard already shows `suspendedAt` to members; the note is restricted. |

**Removed from Phase 4 (D-01/D-02):** `GET /api/v1/storefront/sellers/:id` and the `seller` list filter — public seller storefronts and seller identity/disclosure are deferred to D-21 (separate owner approval).

Errors: `400 invalid_request` (bad filter/limit), `400 invalid_cursor` (tampered/mismatched cursor), `404 not_found` (every public miss), `429 rate_limited` (+`Retry-After`), `503 storefront_unavailable` (public DB unconfigured/unavailable). Admin routes reuse the existing envelope (`401/403 role_forbidden`, `403 review_separation_required`, `400 invalid_request`, `409`).

### 3.2 Public read SQL (executed against the views in validation)

List (keyset; `$2/$3` = cursor key omitted on first page, `$4` = limit):

```sql
-- Runs as aura_public on the SECURITY DEFINER view; no internal ids, no seller.
select p.slug, p.title, p.summary, p.approved_at, p.category_slug, p.category_name,
       (select m.url from aura.public_product_media m
         where m.product_slug = p.slug order by m.position limit 1) as hero_image
  from aura.public_products p
 where ($1::text is null or p.category_slug = $1)
   and ($2::timestamptz is null or (p.approved_at, p.slug) < ($2, $3))
 order by p.approved_at desc, p.slug desc
 limit $4;
```

Detail resolution (live first, then redirect — T-05):

```sql
-- 1) live (definer view; discovery columns only)
select slug, title, summary, description, approved_at, category_slug, category_name
  from aura.public_products where slug = $1;
-- 2) only if (1) returned nothing:
select canonical_slug from aura.public_slug_redirects where slug = $1;
-- children keyed by the public product slug (never an internal id):
--   aura.public_product_variants / _media / _attributes where product_slug = $1
-- No seller query: public seller identity/disclosure is deferred (D-21).
```

While the publication predicate holds, working-copy child rows are guaranteed identical to the approved revision (any edit flips `pending_changes` in the same transaction via `catalogue_child_guard`), so reading live children is reading approved content. This invariant is why the public views may read child tables directly instead of parsing revision JSON.

### 3.3 Signed cursor (T-07)

`cursor = base64url(payload) + "." + base64url(HMAC-SHA256(secret, payload))`, payload = `{"v":1,"r":"products","f":<sha256(filters) truncated 16 hex>,"k":[approvedAtISO,id],"l":limit}`. Verification: recompute HMAC with `crypto.timingSafeEqual`; reject unless `v/r/f/l` match the current request. Tamper/mismatch → `400 invalid_cursor`. Secret: `PUBLIC_CURSOR_SECRET` (≥32 chars) **required in production** when the public surface is enabled; dev/test generate an ephemeral per-process secret (cursors do not survive restarts there — documented). No new dependency (`node:crypto`).

### 3.4 Public rate limiting (T-06) and trusted proxy (T-08)

- Bucket `sf:<sha256(clientIp) hex slice 32>`, 60 s window, upsert into `aura.public_rate_limits` via the **public pool** (same shape as `hitAuthRateLimit`, separate table). Limit `PUBLIC_READ_IP_LIMIT` (default 240/min, config-tunable). Over limit → `429 rate_limited` + `Retry-After`. Opportunistic prune of windows older than 1 h via the public pool. If the limiter query fails, fall back to a per-instance in-memory counter with the same limit and log a warning — never unlimited, never a full browsing outage (free reads; paid actions keep fail-closed rules).
- `TRUST_PROXY` config: `off` (default) | `loopback` | CIDR list | hop count → `app.set("trust proxy", …)` only when configured. `clientIp = req.ip ?? req.socket.remoteAddress`. Default off means proxy headers are ignored (no spoofing); behind an ingress the owner sets the ingress CIDRs (deployment config, D-10). Without it, all proxied clients share one bucket — documented, not silently trusted.

### 3.5 Configuration additions (`server/config.ts`, fail-closed)

| Var | Rule |
| --- | --- |
| `DATABASE_PUBLIC_URL` | Optional Postgres URL (same validator as `DATABASE_URL`); production TLS rule applies. Absent → public routes `503 storefront_unavailable`. |
| `PUBLIC_CURSOR_SECRET` | ≥32 chars; **required in production** if `DATABASE_PUBLIC_URL` is set; ephemeral random otherwise. |
| `TRUST_PROXY` | Default `off`; validated CIDR/hop/loopback values. |
| `PUBLIC_READ_IP_LIMIT` | Int 10–10000, default 240. |

`createServices` builds a second `PgDatabase` (`max: 3`) for the public pool only when configured; `close()` closes both. `.env.example` documents the new vars as inert comments, including the operator login SQL (§6.3).

## 4. The 20 review issues — problem, solution, safety, changes, tests

Legend: **Executed** = run during this planning task on disposable PGlite 0.5.16 / PostgreSQL 18.6 (`validation/phase-4/validate.ts`, 76 checks) or the real Express harness (`probe-app.ts`, 9 checks); logs in `validation/phase-4/results/`. **Proposed** = implementation-phase tests, not yet written.

### 4.1 PostgreSQL function EXECUTE privileges
- **Problem:** PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function by default. A public role that can execute identity helpers (`is_active_member`, `is_platform_admin`) plus a caller-settable `aura.principal_id` GUC becomes a membership/privilege oracle. Existing `touch_updated_at()` still had PUBLIC EXECUTE.
- **Solution:** 0008 §6 revokes PUBLIC on all new trigger functions and `touch_updated_at()`, grants the new guards to `aura_app` only; `aura_public` receives **zero** function EXECUTE. Helper-calling RLS policies are scoped `TO aura_app` (see 4.4) so the public role never needs a helper.
- **Why safe:** trigger firing does not re-check EXECUTE (proven), so revoking PUBLIC cannot break writes; the public path evaluates only local row predicates.
- **Changes:** DB only (0008). **Tests:** Executed 1.7, 1.8, 1.9, 1.11, 1.12. Proposed: migration catalog assertions in `tests/migrations.test.ts` (PUBLIC execute absent on every `aura` function; `aura_public` has none).

### 4.2 Public child-view SQL and field allowlisting
- **Problem:** a public detail page needs variants/media/attributes, but base tables carry private columns (SKU, `created_by`, reference media, seller `legal_name`/`business_email`/review notes). A view alone is not a boundary if the role can also read base columns.
- **Solution (D-02 owner-directed):** `aura_public` gets **zero base-table SELECT grants**. Five **SECURITY DEFINER** discovery views (`public_products`, `public_product_variants`, `public_product_media` [images only], `public_product_attributes`, `public_slug_redirects`) are owner-owned (no `security_invoker`), fully schema-qualified, call no functions, and select only slug-keyed discovery columns; the view `WHERE` joins the published parent + approved, non-suspended seller. Internal ids are used only inside joins and are never selectable. The Phase 3 `storefront_products` keeps `security_invoker` + its column list for `aura_app` (adds the suspension filter) and is not granted to `aura_public`. Role-targeted base RLS policies remain as defense-in-depth.
- **Why safe:** a direct base-table query as `aura_public` is denied outright (no grant); `SELECT *` on a base table fails; the only readable objects are the discovery views, which expose no internal identifier or seller field. `security_invoker` + column grants were rejected because every join/predicate column would have to be granted and would then be directly queryable.
- **Changes:** DB (0008 §2–4); API serializers read only views. **Tests:** Executed 1.3–1.5, 1.14, 2.1–2.9, 2.12–2.14. Proposed: API contract tests asserting response field sets equal D-02; RLS suite for child visibility under draft/submitted/archived/pending/suspended parents.

### 4.3 Security-definer ownership and search_path
- **Problem:** security-definer functions run as their owner; a superuser/bypassrls owner or an unpinned `search_path` turns them into escalation paths.
- **Solution:** Phase 4 adds five SECURITY DEFINER **views** (owner-owned, fully schema-qualified, call no functions — no `search_path` execution hazard) and **one** security-definer **function**, `aura.seller_suspension_note(uuid)`, with pinned `search_path=pg_catalog, aura`, PUBLIC revoked, granted to `aura_app` only, owned by the migration owner; it authorizes the caller via `is_active_member(org, {owner,admin})` or `is_platform_admin()`. Existing definers (`is_active_member`, `is_platform_admin`, `build_product_snapshot`, org provisioning) keep pinned `search_path` and PUBLIC revoked. Production requirement: migration/login roles are non-superuser and the view/function owner owns the `aura` tables; target-side check of `prosecdef`, `proconfig`, `proowner`, view ownership and effective grants.
- **Why safe:** the public path reads only the discovery views (no function execution); the note accessor is `aura_app`-only and role-checked; authenticated paths keep the Phase 2/3 contract already tested.
- **Changes:** DB (0008); deployment checklist (§6.4). **Tests:** Executed 1.7/1.11 (public cannot execute), 1.14 (definer view), 1.15 (accessor grant), 3.7–3.10 (accessor authorization). Proposed: extend `tests/migrations.test.ts` to assert every definer function has pinned `search_path`, PUBLIC revoked, and owner ∉ {`aura_app`,`aura_public`}; target-side metadata comparison at G1.

### 4.4 Reader-role permissions and role inheritance
- **Problem (proven by executed validation):** Phase 2/3 member/admin policies were created **without `TO`**, so they target every role and call `is_active_member()`/`is_platform_admin()`. A restricted public role reading through a `security_invoker` view fails with `permission denied for function is_active_member` — the first validation run crashed exactly here. Granting helper EXECUTE to the public role would create an oracle (4.1). Also, `aura_app` is `NOINHERIT`; it matters that a LOGIN member of a group still inherits the group's grants and matches `TO group` policies.
- **Solution:** 0008 `ALTER POLICY … TO aura_app` on all 35 helper-calling policies (identity, tenancy, catalogue, audit); pure `using(true)` reference-data policies stay PUBLIC. `aura_public` is a `NOLOGIN NOINHERIT` group like `aura_app`; the operator creates a LOGIN role and grants the group to it (the login keeps default INHERIT, so it inherits grants and matches role-targeted policies).
- **Why safe:** behaviour for `aura_app` (and any inheriting login) is unchanged — asserted by the unchanged member/cross-tenant tests; the migration owner still bypasses RLS; the public role evaluates only its own local predicates.
- **Changes:** DB (0008 §2). **Tests:** Executed 1.10 (login inheritance reads), 1.12 (all helper policies scoped), 1.13 (reference policies PUBLIC), 2.15 (member behaviour unchanged), 2.10 (forged principal ineffective). Proposed: RLS matrix re-run for `aura_app` logins; migration assertion that no helper-calling policy targets PUBLIC.

### 4.5 Global slug collision migration and rollback
- **Problem:** slugs are unique only per organization; public URLs need global uniqueness. Cross-org duplicates exist; a naive global index fails, and a naive backfill hits lifecycle guards.
- **Solution:** 0009 renames later duplicates deterministically (earliest by `(created_at, id)` keeps the slug; suffix `-<id[0:8]>`, truncated to the 81-char limit, numeric disambiguation loop), records `slug_redirects(slug, replacement_slug, reason='global_collision')`, then creates `products_slug_global_key`. Rollback drops the index, restores originals from `replacement_slug`-matched rows, deletes only collision redirects, and **aborts on drift** (`slug_redirect_rollback_conflict`) rather than guessing.
- **Why safe:** one transaction; per-org constraint preserved (restoring duplicates is legal); deterministic and re-appliable; rollback never touches future non-collision redirects; audit trigger stays active so renames are recorded.
- **Changes:** DB (0009 + rollback). **Tests:** Executed 4.3–4.8, 4.12–4.14 (rename, redirect, index, timestamps, audit, global conflict, rollback, re-apply, drift abort). Proposed: migration test with multi-org duplicate fixtures incl. an 81-char slug and a suffix collision; rollback conflict test.

### 4.6 Existing trigger compatibility
- **Problem (proven):** the backfill UPDATE fires `products_guard` (requires a bound principal + membership → `identity_required` for a migration operator) and, for suspended sellers, `catalogue_suspension_guard` (`seller_suspended`). `session_replication_role=replica` needs superuser (unavailable on managed PG).
- **Solution:** the migration (run as table **owner**) disables exactly `products_guard`, `products_touch`, `products_catalogue_suspension` for the backfill and re-enables them in the same transaction. Owner can disable user triggers without superuser. Audit trigger remains active (actor falls back to `created_by`); `products_touch` disabled preserves historical `updated_at` ordering; `review_separation_guard` is a no-op for non-decision updates.
- **Why safe:** minimal trigger surface disabled, same-transaction re-enable, every rename audited; no history rewrite, no superuser requirement.
- **Changes:** DB (0009/rollback). **Tests:** Executed 4.1/4.2 (failure without handling), 4.6 (timestamps preserved), 4.7 (audited rename). Proposed: assert triggers re-enabled after migration/rollback (`pg_trigger.tgenabled`), and that a suspended seller's product is still renamed.

### 4.7 Slug redirect storage and resolution
- **Problem:** renamed products need stable legacy resolution without hijacking live slugs or leaking unpublished targets.
- **Solution:** `aura.slug_redirects` (unique `slug`, composite tenant FK, `replacement_slug`, reason). Resolution order: **live published product first**, then `public_slug_redirects` (published targets only). A collision redirect whose original slug is still held by the kept product is inert (live wins) — correct, because pre-Phase-4 per-org URLs were never public. Redirects point at `product_id`, so chains/cycles are impossible. Slugs are never freed (products are never deleted), so no reuse hazard.
- **Why safe:** public view exposes only `slug → canonical_slug` of published products; runtime roles have read-only grants; writes are migration-only.
- **Changes:** DB (0008 §7); API detail handler (§3.2). **Tests:** Executed 4.9–4.11. Proposed: API tests for redirect → 200 + canonicalSlug, redirect-to-unpublished → uniform 404, live-wins.

### 4.8 Seller suspension and restoration state preservation
- **Problem:** a `suspended` status value would destroy or duplicate prior lifecycle state; restoration must return the exact approved state.
- **Solution:** overlay columns `suspended_at/suspended_by/suspension_note` with a consistency constraint; `seller_suspension_guard` (admin-only, note required, atomic — no mixed status/content edit, restore clears all three). `status`, `approved_revision_id` and product rows are never touched by suspension. **D-03 note confidentiality:** `suspension_note` is hidden from `aura_app` by column grant and read only via `aura.seller_suspension_note(uuid)` (owner/admin of the org or platform admin); member-readable audit detail records `noteRecorded`, never the note text. Members still see `suspended_at` (state), not the note.
- **Why safe:** state preservation is structural, not procedural; the guard refuses any attempt to mix a decision with content changes; audit records both decisions without leaking the confidential note.
- **Changes:** DB (0008 §1); admin API + UI; `GET /api/v1/seller/suspension` accessor route. **Tests:** Executed 3.2, 3.5–3.10, 3.14, 3.20–3.25. Proposed: API suspend/restore lifecycle tests; UI test for the suspension dialog and state badge; note-visibility matrix (member denied, owner/admin/platform allowed).

### 4.9 Four-eyes protection for suspension
- **Problem:** suspension/restore are moderation decisions; a dual-role admin must not decide their own organization.
- **Solution:** `review_separation_guard` is extended (CREATE OR REPLACE in 0008) so a `suspended_at` transition is a "decision" exactly like approve/reject — one definition of four-eyes. The suspension guard fires first (`seller_profiles_0_suspension_guard`, name-ordered) so non-admins get `forbidden` and dual-role admins get `review_separation_required`; both refuse. API pre-check mirrors the rule (`403 review_separation_required`).
- **Why safe:** the database refuses direct SQL bypass; trigger order only changes which denial surfaces first.
- **Changes:** DB (0008); `review.ts` pre-check reuse. **Tests:** Executed 3.1 (dual-role **suspend** refused), 3.11 (dual-role **restore** refused), 3.12 (non-member RLS zero rows), 3.13 (member refused). Proposed: API four-eyes tests for suspend and restore.

### 4.10 Rate-limit storage isolation
- **Problem:** sharing `aura.auth_rate_limits` would let anonymous traffic inflate login/registration/recovery counters (lockout DoS) and couple pruning.
- **Solution:** separate `aura.public_rate_limits`; `aura_public` gets CRUD on it only; **two-way isolation** (public role cannot touch auth limits; app role cannot touch public limits). Same upsert shape as the auth limiter, different table and pool.
- **Why safe:** worst case a compromised public credential poisons public buckets only; auth counters and their pruning are untouched.
- **Changes:** DB (0008 §5); `storefront/limits.ts`. **Tests:** Executed 5.1–5.3. Proposed: limiter window/increment/prune tests; 429 + Retry-After contract; fallback-counter test on limiter failure.

### 4.11 Anonymous public-read database connection
- **Problem:** anonymous reads on the app pool would share fate/limits with authenticated work and risk identity-context leakage.
- **Solution:** separate `PgDatabase` (`max: 3`) using `DATABASE_PUBLIC_URL` → `aura_public_login` (member of `aura_public`). No principal binding, no identity-table grant, no helper EXECUTE. Missing config → `503 storefront_unavailable`; never fall back to the app pool (T-15).
- **Why safe:** even a handler bug cannot reach private data: the role has no grant/policy/function for it (proven). Pool exhaustion by anonymous traffic cannot starve authenticated requests.
- **Changes:** `services.ts`, `config.ts`, `.env.example`. **Tests:** Executed 1.6, 1.10, 2.11. Proposed: config fail-closed matrix; 503 when unconfigured; pool isolation (public pool closed independently).

### 4.12 CSRF middleware compatibility
- **Problem:** public GETs must work with zero cookies and must not be blocked by the CSRF/origin guard; mutations must keep full protection.
- **Solution:** no middleware change. `csrfGuard` already passes safe methods and issues the double-submit cookie; `attachSession` does no DB work without a cookie. Public routes are GET-only, responses `no-store` (so a `Set-Cookie` on an anonymous GET cannot poison shared caches). Mutations keep origin + session-bound CSRF.
- **Why safe:** proven behaviour; no weakening of any check.
- **Changes:** none. **Tests:** Executed A.2, A.4, A.5, A.9. Proposed: anonymous public GET with foreign Origin succeeds; public POST (nonexistent) → 404/405 never bypasses CSRF; admin suspend without CSRF → 403.

### 4.13 Signed cursor integrity
- **Problem:** opaque cursors that encode sort keys/filters can be tampered with to skip scoping or probe other collections.
- **Solution:** HMAC-SHA256 signed payload bound to route + filter hash + limit (§3.3); constant-time verification; mismatch → `400 invalid_cursor`. Filters are re-applied server-side regardless; the cursor only carries the keyset position.
- **Why safe:** tampering is detected; scope is never taken from the client; no new dependency.
- **Changes:** `storefront/cursor.ts`, config. **Tests:** Proposed: round-trip, tampered signature, wrong-route/filter/limit reuse, expired-secret rotation behaviour. (Design is app-level; no SQL validation applicable.)

### 4.14 Trusted proxy and IP handling
- **Problem:** no `trust proxy` is configured; behind an ingress every client would share the proxy IP (one bucket → mass 429), while blindly trusting `X-Forwarded-For` enables spoofing.
- **Solution:** explicit `TRUST_PROXY` (default off; loopback/CIDR/hop values) applied via `app.set`; buckets use `req.ip` only when configured. Documented deployment step at G1/G2.
- **Why safe:** default ignores forwarded headers (no spoofing); configured trust is bounded to known proxies.
- **Changes:** `config.ts`, `app.ts`. **Tests:** Proposed: spoofed XFF ignored when off; correct client IP when CIDR configured; shared-bucket behaviour documented.

### 4.15 No-store response consistency
- **Problem (proven defect):** the `no-store` middleware is mounted **after** the v1 routers, so handled `/api/v1` responses never receive it (probe A.3: `cache-control = null`), contradicting the Phase 0 standard.
- **Solution:** move `app.use("/api", no-store…)` **before** the `if (services)` block in `createApp`. One-line reorder; all API responses (v1 included) then carry `no-store`. Public caching stays off (D-05 default preserves approved policy).
- **Why safe:** header-only change; no routing/authorization impact; covered by existing API tests plus a new header assertion.
- **Changes:** `server/app.ts`. **Tests:** Executed A.1/A.3/A.7 (current behaviour). Proposed: assert `no-store` on v1 success, 401, 404, public 200/404/429.

### 4.16 Uniform public 404 behaviour
- **Problem:** distinct errors for unknown vs draft vs suspended slugs would be an existence oracle.
- **Solution:** every public detail miss — unknown, malformed slug, draft, submitted, rejected, archived, pending-changes, suspended seller, redirect-to-unpublished — returns the identical `404 {"error":"not_found"}` with `no-store`. List filters validate input (`400 invalid_request`) but never reveal existence.
- **Why safe:** no state-dependent response shape/status; timing is dominated by the same indexed lookup (residual timing differences noted as a limitation, not a claim of constant time).
- **Changes:** `storefront/public.ts`. **Tests:** Proposed: matrix of all miss cases asserting identical status/body/headers.

### 4.17 Publication state after suspension
- **Problem:** suspension must de-publish immediately and restoration must re-publish the exact prior approved content.
- **Solution:** every public view joins `seller_profiles` with `status='approved' AND suspended_at IS NULL`; `storefront_products` is extended with the same filter (same column list, legal CREATE OR REPLACE). Suspension touches no product row; restoration clears the overlay → products reappear with unchanged `approved_revision_id`.
- **Why safe:** publication is derived from durable state in one predicate; no cache to invalidate (no-store); proven across suspend/restore.
- **Changes:** DB views (0008). **Tests:** Executed 3.3, 3.4, 3.22, 3.24. Proposed: API tests that a suspended seller's detail/list 404 and return after restore.

### 4.18 Existing configurator route conflicts
- **Problem:** `/products/:slug` already renders the preview `GenericConfigurator`; `/catalog` is the preview catalogue. Reusing these paths changes an existing user-facing workflow (owner-only).
- **Solution (D-01 owner-directed):** additive namespace `/marketplace` and `/marketplace/product/:slug` only; extend `shared/routes.ts` allowlist with `marketplace(?:\/product\/[\w-]+)?`; add `App.tsx` branches (distinct prefixes, no shadowing of `/products/`). **No public seller route in Phase 4** (D-21). Previews, cart, wishlist and containment tests unchanged.
- **Why safe:** zero modification of existing routes/components; browser containment suite stays valid (re-run 3/3).
- **Changes:** `shared/routes.ts`, `client/src/App.tsx`, two new pages + `storefront` client lib. **Tests:** Proposed: routing allowlist tests; jsdom render tests; browser journey incl. preview regression. Executed: baseline routing/containment suites pass unchanged (294 tests).

### 4.19 Cross-tenant isolation
- **Problem:** the public path must not leak drafts or other tenants' private data; admin suspension must not become a cross-tenant write path.
- **Solution:** public role sees only published rows through the definer discovery views (zero base grants; the view predicate is the boundary); child views require a published parent; forged `aura.principal_id` has no effect (no helper access). `aura_app` member behaviour is unchanged (own drafts visible, cross-tenant denied). Suspension routes are platform-admin + four-eyes + org-scoped by path, inside the existing transaction contract.
- **Why safe:** six existing layers remain; the public layer adds zero-base-grants + a definer-view publication predicate, proven by negative tests (direct base reads denied).
- **Changes:** DB + storefront module. **Tests:** Executed 2.6–2.15, 3.12. Proposed: full public RLS matrix (every lifecycle state × every child table), admin cross-org suspension denial.

### 4.20 Existing production PostgreSQL compatibility
- **Problem:** PGlite is PostgreSQL 18.6; production (e.g. Supabase) may be older; migrations must not require superuser or PG18-only features.
- **Solution:** minimum **PostgreSQL 15** (`security_invoker` views). All SQL uses long-stable features: column grants, role-targeted policies, `ALTER POLICY`, DO blocks, `CREATE UNIQUE INDEX`, owner-level `DISABLE TRIGGER`. No `MERGE`, no `uuidv7()`, no `session_replication_role`. Plain in-transaction unique index is acceptable at current catalogue scale; a large-table deployment uses `CREATE UNIQUE INDEX CONCURRENTLY` outside the transaction (documented alternative). Migration role must **own** the `aura` tables (true when migrations ran as the creating role); request logins are non-superuser members of the group roles.
- **Why safe:** semantics validated on 18.6; feature floor explicitly 15; no privileged operation beyond ownership.
- **Changes:** migration headers + deployment checklist. **Tests:** Executed 6.1/6.2 (double replay on fresh engine). Proposed: replay on a real disposable PostgreSQL 15/17 at G1; target-side ledger/grant/exposure comparison (owner gate).

## 5. Frontend plan (HOLO, additive)

- `client/src/pages/MarketplacePage.tsx` — public list: filter chips (category), cursor "load more", hero images, HOLO cards; no price/cart CTA (commerce unavailable wording consistent with containment). No seller filter (D-01).
- `client/src/pages/MarketplaceProductPage.tsx` — detail: gallery (images only), variant options (read-only display), attributes; canonical-URL replacement when `redirectedFrom` is present; uniform not-found state reuse (`CommerceStatus`). No seller card / seller identity (D-02).
- **No `MarketplaceSellerPage` in Phase 4** — public seller storefronts deferred (D-21).
- `client/src/lib/storefront.ts` — same-origin relative GETs, no credentials needed (cookies tolerated), cursor handling.
- `AdminReviewPage.tsx` — suspend/restore actions with a mandatory-note dialog and suspension badge; gated on the server-reported `platformAdmin` flag (server re-decides every request).
- `shared/routes.ts` + `App.tsx` additive branches; `index.css` additive `market-*`-style block only; no existing selector/token/component modified.

## 6. Migration and deployment plan

### 6.1 Order
1. `0008_public_storefront.sql` (roles, policies, suspension, views, limiter, redirects table).
2. `0009_global_product_slugs.sql` (backfill + global index).
Both additive; `0001`–`0007` untouched; each runs in one transaction as the table owner. Transparency: 0008 forward-replaces two Phase 3 function definitions (`review_separation_guard` to add suspension decisions; `audit_seller_profile` to exclude the overlay columns from the generic field-diff) and the `storefront_products` view (adds the suspension filter, same column list) via `CREATE OR REPLACE` — this is a normal forward migration, not an edit of prior migration files, and behaviour for non-suspended rows is unchanged. Rollback for 0009 is provided and validated; 0008 rollback (if ever needed) is a reviewed forward-fix document, not a destructive down-migration (roles/policies can be dropped, suspension columns retained until a reviewed removal).

### 6.2 Application rollout
Deploy code that tolerates both states: public routes return `503 storefront_unavailable` until `DATABASE_PUBLIC_URL` is configured; admin suspension routes require the 0008 columns (deploy after 0008). No feature flag needed beyond config presence (fail-closed).

### 6.3 Operator login provisioning (production, out of band)
```sql
create role aura_app_login    login password '<secret>';  grant aura_app    to aura_app_login;
create role aura_public_login login password '<secret>';  grant aura_public to aura_public_login;
-- DATABASE_URL=postgres://aura_app_login:…@host/db?sslmode=require
-- DATABASE_PUBLIC_URL=postgres://aura_public_login:…@host/db?sslmode=require
```
Logins keep default INHERIT (inherit group grants; match `TO group` policies — validated 1.10). Never use `postgres`/service-role for requests.

### 6.4 Target-side verification checklist (owner gate, G1)
Migration ledger matches `0001`–`0009`; effective grants incl. PUBLIC/default privileges; `aura` not exposed via PostgREST; direct PostgREST anon/authenticated reads of private tables denied and only approved projections readable; definer owners/search_path; `relrowsecurity` on all tenant tables; non-superuser request logins; negative direct-SQL test as `aura_public_login`.

## 7. Test plan

### 7.1 Executed during planning (evidence)
- `validation/phase-4/validate.ts` — **76/76 pass** on PGlite 0.5.16 / PostgreSQL 18.6 after replaying real `0001`–`0007` + proposed 0008/0009: roles/zero-base-grants/EXECUTE/definer-view (1.1–1.15), anonymous reads & negative paths incl. the exact API list query (2.1–2.17), suspension lifecycle/four-eyes/freeze/restore/note-confidentiality (3.1–3.25), slug backfill/redirects/rollback/drift (4.1–4.14), limiter isolation (5.1–5.3), double replay (6.1–6.2). Log: `validation/phase-4/results/sql-validation.log`.
- `validation/phase-4/probe-app.ts` — **9/9 pass** on the real Express app + disposable DB: no-store defect confirmed (A.3), anonymous GET compatibility (A.2/A.4/A.9), cross-site mutation refusal (A.5), uniform API 404 (A.6/A.7), seller auth requirement (A.8). Log: `validation/phase-4/results/app-probe.log`.
- Baseline regression: `pnpm check` clean; **18 files / 294 tests pass**; build OK; **browser suite 3/3 pass, 0 fail, 0 skipped** (`validation/phase-4/results/browser-baseline.log`).
- Two design defects were found by execution and fixed in the proposal: (a) public reads failed on helper-calling PUBLIC policies → `ALTER POLICY … TO aura_app` (T-01); (b) `catalogue_suspension_guard` referenced `old.status` on child tables (SQL AND does not short-circuit) → nested IFs; plus trigger-ordering refinement for atomicity errors.

### 7.2 Proposed implementation tests (to be written in the phase)
- `tests/migrations.test.ts` extensions: 0008/0009 replay, catalog assertions (roles, zero base grants, definer views, policy scoping, function EXECUTE, note-accessor grant, indexes, triggers re-enabled).
- `tests/storefront-rls.test.ts`: public-role matrix (every lifecycle state × child tables), forged identity, write denials, login inheritance, suspension visibility, redirect visibility.
- `tests/storefront-api.test.ts`: list/detail contracts, field allowlists, pagination + cursor tamper, uniform 404 matrix, no-store on every response, 429 + Retry-After, 503 unconfigured, admin suspend/restore + four-eyes + CSRF.
- `tests/storefront-ui.test.tsx` (jsdom): three pages render, not-found states, admin suspension dialog gated on server flag.
- `tests/browser-marketplace.mjs`: anonymous browse → detail; suspend → disappears → restore → reappears; preview configurator/cart/checkout containment regression; zero page errors.
- Config tests: new vars fail-closed matrix; trusted-proxy parsing.
- Concurrency note: Phase 4 is read-only + single-row moderation writes; PGlite suffices for acceptance, with the standard caveat. Real-PG concurrency is mandatory from Phase 5.

### 7.3 Browser baseline status (executed)
`pnpm build` succeeds. The browser suite first could not launch Chromium in this sandbox (missing NSS/NSPR — the same image gap recorded in the Phase 3 report). Applying the documented sandbox-only workaround (decompress `@sparticuz/chromium` `bin/al2023.tar.br` to `/tmp/al2023`, run with `LD_LIBRARY_PATH=/tmp/al2023/lib`) resolved it: **3 tests / 3 pass / 0 fail / 0 skipped / 0 todo** in ~19.7 s (`validation/phase-4/results/browser-baseline.log`), covering auth/verification/recovery/protected routes/storefront, seller onboarding→approval, and catalogue→configurator→local cart→unavailable checkout containment. No repository file was changed for this; it is sandbox environment setup only. Hosted CI (`google-chrome` on ubuntu-24.04) remains the authoritative browser gate and was green on the Phase 3 PR (run `45943762715`).

## 8. Acceptance criteria

1. D-01…D-04 owner-directed (2026-11-27) and reflected in the proposal; implementation go-ahead (D-22) granted; scope unchanged from §1.
2. Migrations 0008/0009 replay cleanly on a fresh engine after 0001–0007; rollback validated; no edits to prior migrations.
3. Public reads work with zero cookies; private columns/tables/functions unreachable as `aura_public` (negative tests at the DB layer, not only HTTP).
4. Suspension preserves and restores exact prior state; four-eyes enforced in DB and API for **both suspend and restore**; seller writes frozen while suspended; admin cleanup allowed; decisions audited; **suspension note confidential to authorized owners/admins/platform admins** (members see state, not the note).
5. Global slugs unique; collision migration deterministic, audited, reversible; redirects resolve live-first; uniform public 404.
6. `no-store` on every API response; signed cursors tamper-evident; public limiter isolated; trusted-proxy default off.
7. Preview configurators/cart/wishlist/containment unchanged; full baseline regression (294+) plus new suites green in hosted CI; no skipped/weakened mandatory tests.
8. Docs consistent; phase report separates executed vs proposed evidence; no production-readiness claim.

## 9. Implementation sequence (after authorization)

1. Migrations 0008/0009 + rollback, with migration tests.
2. Config/services (public pool, cursor secret, trust proxy, limiter config) + config tests.
3. `storefront` module (public router, cursor, limits) + app no-store reorder + API tests.
4. Admin suspend/restore routes + four-eyes pre-check + tests.
5. Frontend pages + routing allowlist + jsdom tests.
6. Browser suite; full regression; security review against §4; defect fixes.
7. Docs + phase report; owner authorization for commit/push/PR; hosted CI; explicit merge approval; verify merge.

## 10. Risks and limitations

- PGlite proves semantics, not multi-backend contention or deployed grants; target verification is an owner gate (G1).
- Uniform 404 removes content oracles but not all timing side channels; stated honestly.
- Global unique index briefly locks writes during creation (acceptable at current scale; CONCURRENTLY path documented for growth).
- Public limiter DB failure degrades to per-instance counters (never unlimited); a determined distributed client can still consume public read capacity — ingress-level limits remain a deployment responsibility.
- Suspension is marketplace-level; identity-level blocking is a separate future decision (not silently included).
