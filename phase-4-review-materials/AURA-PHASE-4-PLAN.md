# AURA Phase 4 Technical Plan — Public Marketplace Storefront, Global Slugs, Seller Suspension

**Status:** planning and technical preparation complete · **implementation NOT started** · D-01–D-04 owner-directed (2026-11-27); second-review corrections applied 2026-11-27 (discovery search/filter/sort restored; cursor fixed + 16 tests; definer ownership explicit; defense-in-depth policies completed) · awaiting owner authorization (D-22) and the discovery UX choices (D-23/D-24/D-25).
**Baseline:** `master` = `b12a5596bf3b454b844c5d3b5bc83784247e300f` (Phases 0–3 merged, PRs #1–#4), verified 2026-11-27.
**Provenance note:** no prior `AURA-PHASE-4-PLAN.md` exists in any commit, branch or PR (`git log --all -- AURA-PHASE-4-PLAN.md` is empty; `git ls-remote` shows only `master` and the four merged phase branches). This document is therefore the authoritative Phase 4 plan, reconstructed from the owner's 20-issue review list and the verified repository state. It does not pretend to edit a previous file.
**Controlling documents:** [AURA-MASTER-SPECIFICATION.md](AURA-MASTER-SPECIFICATION.md) (product + decision register) · [AURA-COMPLETE-ROADMAP.md](AURA-COMPLETE-ROADMAP.md) (scope) · [AURA-AGENT-OPERATING-RULES.md](AURA-AGENT-OPERATING-RULES.md) (process) · [AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md) (deployment ownership/migration prerequisites runbook).

---

## 1. Scope

**In scope (read-only public marketplace + moderation tooling):**

- Anonymous public catalogue: product list and product detail (variants/media/attributes), minimum discovery fields only. **No public seller profile pages in Phase 4** (D-01/D-21).
- **Product discovery: search, filtering and sorting** (owner-restored, 2026-11-27 review). Text search over the public title/summary; category + attribute-value filtering; selectable sort order. These query only the existing D-02 allowlist — **no new public fields**. User-facing menus/semantics are registered separately (D-23/D-24/D-25).
- Globally unique product slugs with a deterministic collision migration, redirect storage/resolution and a reviewed rollback.
- Seller suspension/restoration: state-preserving, four-eyes, audited, with immediate de-publication.
- A dedicated least-privilege anonymous database role and connection pool.
- Public rate limiting isolated from auth rate limits; signed cursor pagination; trusted-proxy configuration; uniform public 404; `no-store` consistency fix.
- Additive HOLO frontend pages under a new namespace; suspension controls on the existing admin review screen.

**Explicit exclusions:** prices, currency, stock, cart/checkout for marketplace items, payments, refunds, shipping, manufacturing, **semantic/vector search and dedicated search-index infrastructure** (basic discovery search IS in scope; a GIN/text index is a measured follow-up, not a Phase 4 commitment), media uploads/CDN, seller slug renames (D-13), identity-level suspension, public caching/CDN (D-05), any change to preview configurators, cart, wishlist or containment denials.

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
| `GET /api/v1/storefront/products?limit&cursor&category&q&attr&sort` | Published products with **search, filtering, sorting**. `q` (optional, 1–100 chars): word search over title+summary (`to_tsvector('simple', …) @@ websearch_to_tsquery('simple', q)`). `category` (optional slug). `attr` (repeatable `key:value`): attribute-value filter via `public_product_attributes`. `sort`: `newest` (default, `approved_at DESC, slug DESC`) or `title` (`title ASC, slug ASC`). Keyset pagination matches the sort; default limit 24, max 60; returns `{items, nextCursor}`. Each item: `slug, title, summary, category {slug, name}, approvedAt, heroImage`. Search/filter/sort use **only the D-02 allowlist — no new fields, no internal ids, no seller fields**. User-facing menus/semantics: D-23/D-24/D-25. |
| `GET /api/v1/storefront/products/:slug` | Published product detail: `slug, title, summary, description, approvedAt, category {slug, name}` + variants (`title, size, colour, material, position`) + media (images only: `kind, url, altText, position`) + attributes (`key, label, value`). **No internal ids, no seller identity/disclosure** (D-02). If the slug is a redirect of a published product, returns `200` with `canonicalSlug` and `redirectedFrom` (client replaces the URL). Every other case → uniform `404 {"error":"not_found"}`. |
| `POST /api/v1/admin/sellers/:orgId/suspend` | Platform admin, four-eyes, body `{note}` (1–1000 chars, required). Sets the overlay; audited `seller.suspended` (detail records `noteRecorded`, not the note text). |
| `POST /api/v1/admin/sellers/:orgId/restore` | Platform admin, four-eyes. Clears the overlay; audited `seller.restored`. |
| `GET /api/v1/seller/suspension` | **Authenticated**, seller owner/admin of the org or platform admin only. Returns `{suspendedAt, note}` via `aura.seller_suspension_note(org)`; ordinary members get `403 role_forbidden` (D-03). The existing seller dashboard already shows `suspendedAt` to members; the note is restricted. |

**Removed from Phase 4 (D-01/D-02):** `GET /api/v1/storefront/sellers/:id` and the `seller` list filter — public seller storefronts and seller identity/disclosure are deferred to D-21 (separate owner approval).

Errors: `400 invalid_request` (bad filter/limit), `400 invalid_cursor` (tampered/mismatched cursor), `404 not_found` (every public miss), `429 rate_limited` (+`Retry-After`), `503 storefront_unavailable` (public DB unconfigured/unavailable). Admin routes reuse the existing envelope (`401/403 role_forbidden`, `403 review_separation_required`, `400 invalid_request`, `409`).

### 3.2 Public read SQL (executed against the views in validation)

List (`newest` sort shown; `$1`=category, `$2`=search term, `$3/$4`=attribute key/value,
`$5/$6`=cursor key omitted on first page, `$7`=limit). Runs as `aura_public` on the
SECURITY DEFINER views; search/filter/sort touch only allowlisted columns — no base
access, no internal ids, no seller fields:

```sql
select p.slug, p.title, p.summary, p.approved_at, p.category_slug, p.category_name,
       (select m.url from aura.public_product_media m
         where m.product_slug = p.slug order by m.position limit 1) as hero_image
  from aura.public_products p
 where ($1::text is null or p.category_slug = $1)
   and ($2::text is null
        or to_tsvector('simple', p.title || ' ' || coalesce(p.summary, ''))
           @@ websearch_to_tsquery('simple', $2))
   and ($3::text is null or exists (
         select 1 from aura.public_product_attributes a
          where a.product_slug = p.slug and a.key = $3 and a.value = $4))
   and ($5::timestamptz is null or (p.approved_at, p.slug) < ($5, $6))
 order by p.approved_at desc, p.slug desc
 limit $7;
```

For `sort=title`, the keyset predicate becomes `(p.title, p.slug) > ($5, $6)` and the
order `p.title asc, p.slug asc`; the cursor key is `[title, slug]` (see §3.3). Search and
attribute filters are identical across sorts. At current catalogue scale a sequential
scan is acceptable; a GIN index on the search expression is a **measured** follow-up
(write-amplification reviewed first, per the database architecture), not a Phase 4
commitment. Executed: `validate.ts` 2.16 (list), 2.18 (search), 2.19 (attribute filter),
2.20 (title sort); `cursor.test.ts` B1–B3 (pagination coverage per sort/search).

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

`cursor = base64url(payload) + "." + base64url(HMAC-SHA256(secret, payloadB64))`, payload = `{"v":1,"b":<sha256(binding) hex>,"k":[key0,key1]}`.

- **Keyset matches the actual ordering (owner item 2 fix):** `newest` → `k=[approvedAt, slug]` (ORDER BY `approved_at DESC, slug DESC`); `title` → `k=[title, slug]` (ORDER BY `title ASC, slug ASC`). The previous `[approvedAtISO, id]` payload was inconsistent with the slug-keyed query and is removed; **no internal id is ever placed in a public cursor**. `approvedAt` is carried at **full timestamp precision** (`approved_at::text`, microseconds) so the keyset never skips/repeats rows due to millisecond truncation.
- **Binding (owner item 2):** `b = sha256(canonical({route, q, category, attr(sorted), sort, limit}))`. The cursor is bound to route + search term + every filter + sort order + page limit. Verification recomputes the HMAC (`crypto.timingSafeEqual`) **and** the binding hash; a valid signature under a different binding is still rejected. Tamper/mismatch/malformed/wrong-version → `400 invalid_cursor`.
- Secret: `PUBLIC_CURSOR_SECRET` (≥32 chars) **required in production** when the public surface is enabled; dev/test use an ephemeral per-process secret (cursors do not survive restarts there — documented). No new dependency (`node:crypto`).
- **Reference implementation + executable tests:** `validation/phase-4/cursor.ts` (the exact contract) and `validation/phase-4/cursor.test.ts` (16 tests: round-trip, tampered payload/signature, wrong secret, mismatched route/search/category/attribute/sort/limit, attr-order independence, malformed payloads, and PGlite pagination with no duplicates/omissions for newest, title and search). Log: `validation/phase-4/results/cursor-tests.log`.

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

Legend: **Executed** = run during this planning task on disposable PGlite 0.5.16 / PostgreSQL 18.6 (`validation/phase-4/validate.ts`, **97 checks**; `validation/phase-4/cursor.test.ts`, **16 checks**) or the real Express harness (`probe-app.ts`, 9 checks); logs in `validation/phase-4/results/`. **Proposed** = implementation-phase tests, not yet written.

### 4.1 PostgreSQL function EXECUTE privileges
- **Problem:** PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function by default. A public role that can execute identity helpers (`is_active_member`, `is_platform_admin`) plus a caller-settable `aura.principal_id` GUC becomes a membership/privilege oracle. Existing `touch_updated_at()` still had PUBLIC EXECUTE.
- **Solution:** 0008 §6 revokes PUBLIC on all new trigger functions and `touch_updated_at()`, grants the new guards to `aura_app` only; `aura_public` receives **zero** function EXECUTE. Helper-calling RLS policies are scoped `TO aura_app` (see 4.4) so the public role never needs a helper.
- **Why safe:** trigger firing does not re-check EXECUTE (proven), so revoking PUBLIC cannot break writes; the public path evaluates only local row predicates.
- **Changes:** DB only (0008). **Tests:** Executed 1.7, 1.8, 1.9, 1.11, 1.12. Proposed: migration catalog assertions in `tests/migrations.test.ts` (PUBLIC execute absent on every `aura` function; `aura_public` has none).

### 4.2 Public child-view SQL and field allowlisting
- **Problem:** a public detail page needs variants/media/attributes, but base tables carry private columns (SKU, `created_by`, reference media, seller `legal_name`/`business_email`/review notes). A view alone is not a boundary if the role can also read base columns.
- **Solution (D-02 owner-directed):** `aura_public` gets **zero base-table SELECT grants**. Five **SECURITY DEFINER** discovery views (`public_products`, `public_product_variants`, `public_product_media` [images only], `public_product_attributes`, `public_slug_redirects`) are owner-owned (no `security_invoker`), fully schema-qualified, call no functions, and select only slug-keyed discovery columns; the view `WHERE` joins the published parent + approved, non-suspended seller. Internal ids are used only inside joins and are never selectable. The Phase 3 `storefront_products` keeps `security_invoker` + its column list for `aura_app` (adds the suspension filter) and is not granted to `aura_public`. Role-targeted base RLS policies remain as defense-in-depth.
- **Why safe:** a direct base-table query as `aura_public` is denied outright (no grant); `SELECT *` on a base table fails; the only readable objects are the discovery views, which expose no internal identifier or seller field. `security_invoker` + column grants were rejected because every join/predicate column would have to be granted and would then be directly queryable.
- **Search/filter/sort (owner item 1):** applied as predicates/ORDER BY on the definer views (search via `to_tsvector`/`websearch_to_tsquery` on title+summary; attribute filter via `public_product_attributes`; selectable `newest`/`title` sort). They expose **no new columns** and need **no base grant** — the D-02 allowlist is unchanged.
- **Changes:** DB (0008 §2–4); API serializers read only views. **Tests:** Executed 1.3–1.5, 1.14, 2.1–2.9, 2.12–2.14, 2.16–2.20 (list/search/attribute/sort). Proposed: API contract tests asserting response field sets equal D-02; RLS suite for child visibility under draft/submitted/archived/pending/suspended parents.

### 4.3 Security-definer ownership and search_path
- **Problem:** security-definer functions run as their owner; a superuser/bypassrls owner or an unpinned `search_path` turns them into escalation paths.
- **Solution (owner item 3 — explicit ownership):** Phase 4 adds five SECURITY DEFINER **views** and **one** security-definer **function** (`aura.seller_suspension_note(uuid)`, pinned `search_path=pg_catalog, aura`, PUBLIC revoked, `aura_app`-only, role-checked). **0008 §8 explicitly (re)assigns the five definer views and `slug_redirects` to the catalog table owner** (the role that owns `aura.products`), so view ownership always tracks catalog ownership and is never left with an implicit/privileged migration role.
- **Permitted owner + privilege requirements:** the view owner MUST be the catalog table owner — a **NON-superuser, NOBYPASSRLS** role (recommended NOLOGIN) that **owns every base table the views read** and has CREATE on schema `aura`. The migration role running 0008 has CREATEROLE and is superuser **or** a member of the catalog owner (needed to reassign); it is never a request-processing login.
- **How the views read base tables (no undocumented privileged owner):** PostgreSQL exempts a table's **owner** from that table's RLS unless `FORCE ROW LEVEL SECURITY` is set (the aura tables use `ENABLE`, not `FORCE`). The definer views run as the catalog owner and read base rows via **ownership** — not via superuser/BYPASSRLS and not via any grant to `aura_public`. The view `WHERE` is the publication boundary; `aura_public` holds SELECT on the views only (zero base grants). `storefront_products` stays `security_invoker` (caller privileges) and is NOT reassigned.
- **Why safe:** the public path reads only the discovery views (no function execution); the note accessor is `aura_app`-only and role-checked; authenticated paths keep the Phase 2/3 contract already tested.
- **Changes:** DB (0008 §8); deployment checklist (§6.4); **exact deployment runbook in [AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md)** (role creation/attributes, base-table ownership, executor privileges + membership, helper EXECUTE for the note accessor, verification, grants/default privileges, migration order, rollback). **Tests:** Executed 1.7/1.11 (public cannot execute), 1.14/1.18 (definer mode), 1.15 (accessor grant), **1.16 (view ownership = catalog owner), 1.17 (owner nologin/nosuperuser/nobypassrls + owns base tables), 1.19 (effective grants: views only), 1.20–1.24 (executor membership enables reassignment / non-member denied / member RLS bypass / helper EXECUTE necessary+sufficient / public login view-only)**, 3.7–3.10 (accessor authorization). Proposed: `tests/migrations.test.ts` catalog assertions for view owner + owner attributes + security mode + effective grants; target-side metadata comparison at G1.

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
- **Solution (owner item 2):** HMAC-SHA256 signed payload bound to **route + search term + filters + sort order + page limit** (§3.3); the keyset matches the actual query ordering (`[approvedAt, slug]` for newest, `[title, slug]` for title); constant-time verification of signature **and** binding; mismatch → `400 invalid_cursor`. Filters are re-applied server-side regardless; the cursor only carries the keyset position.
- **Why safe:** tampering is detected; scope is never taken from the client; no new dependency.
- **Changes:** `storefront/cursor.ts`, config. **Tests:** **Executed** `validation/phase-4/cursor.test.ts` — **16/16 pass** (`results/cursor-tests.log`): round-trip, tampered payload/signature, wrong secret, mismatched route/search/category/attribute/sort/limit, attr-order independence, malformed payloads, and PGlite pagination with no duplicates/omissions for newest/title/search. Proposed: port the same cases into `tests/storefront-cursor.test.ts` against the implementation module; secret-rotation behaviour.

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
- **Defense-in-depth policies corrected (owner item 4):** the public `products`/child/`slug_redirects` RLS policies now enforce the **full** publication predicate — approved product + not pending + **approved seller + not suspended** — mirroring the view `WHERE`. So if a base-table SELECT grant to `aura_public` is ever added by mistake, suspended/unapproved sellers' rows still cannot leak. (Chosen approach: **strengthen the policies** rather than remove them; they are a safety net, never evaluated on the live zero-grant public path.)
- **Why safe:** six existing layers remain; the public layer adds zero-base-grants + a definer-view publication predicate + complete defense-in-depth policies, proven by negative tests (direct base reads denied; simulated-grant rows still hidden).
- **Changes:** DB + storefront module. **Tests:** Executed 2.6–2.15, 3.12, **2.21–2.29 (simulated base grant: suspended + unapproved sellers hidden across products/variants/media/attributes; grants revoked afterward)**. Proposed: full public RLS matrix (every lifecycle state × every child table), admin cross-org suspension denial.

### 4.20 Existing production PostgreSQL compatibility
- **Problem:** PGlite is PostgreSQL 18.6; production (e.g. Supabase) may be older; migrations must not require superuser or PG18-only features.
- **Solution:** minimum **PostgreSQL 15** (`security_invoker` views). All SQL uses long-stable features: column grants, role-targeted policies, `ALTER POLICY`, DO blocks, `CREATE UNIQUE INDEX`, owner-level `DISABLE TRIGGER`. No `MERGE`, no `uuidv7()`, no `session_replication_role`. Plain in-transaction unique index is acceptable at current catalogue scale; a large-table deployment uses `CREATE UNIQUE INDEX CONCURRENTLY` outside the transaction (documented alternative). Migration role must **own** the `aura` tables (true when migrations ran as the creating role); request logins are non-superuser members of the group roles.
- **Why safe:** semantics validated on 18.6; feature floor explicitly 15; no privileged operation beyond ownership.
- **Changes:** migration headers + deployment checklist. **Tests:** Executed 6.1/6.2 (double replay on fresh engine). Proposed: replay on a real disposable PostgreSQL 15/17 at G1; target-side ledger/grant/exposure comparison (owner gate).

## 5. Frontend plan (HOLO, additive)

- `client/src/pages/MarketplacePage.tsx` — public list: **search input** (`q`), **category filter chips**, **attribute facet chips** (`attr`), **sort selector** (`newest`/`title`), cursor "load more", hero images, HOLO cards; no price/cart CTA (commerce unavailable wording consistent with containment). No seller filter (D-01). The exact search/sort/facet menus follow D-23/D-24/D-25.
- `client/src/pages/MarketplaceProductPage.tsx` — detail: gallery (images only), variant options (read-only display), attributes; canonical-URL replacement when `redirectedFrom` is present; uniform not-found state reuse (`CommerceStatus`). No seller card / seller identity (D-02).
- **No `MarketplaceSellerPage` in Phase 4** — public seller storefronts deferred (D-21).
- `client/src/lib/storefront.ts` — same-origin relative GETs, no credentials needed (cookies tolerated), cursor handling.
- `AdminReviewPage.tsx` — suspend/restore actions with a mandatory-note dialog and suspension badge; gated on the server-reported `platformAdmin` flag (server re-decides every request).
- `shared/routes.ts` + `App.tsx` additive branches; `index.css` additive `market-*`-style block only; no existing selector/token/component modified.

## 6. Migration and deployment plan

### 6.1 Order
0. **Ownership prerequisite (before 0008):** create `aura_catalog_owner` (NOLOGIN/NOSUPERUSER/NOBYPASSRLS), transfer schema `aura` + the seven catalog base tables to it, and set up the migration executor (CREATEROLE + membership in the catalog owner; helper EXECUTE for the note accessor if a dedicated non-superuser executor). Exact SQL + verification + rollback: **[AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md)** §§2–4.
1. `0008_public_storefront.sql` (roles, policies, suspension, views, limiter, redirects table; §8 reassigns the definer views + `slug_redirects` to the catalog owner).
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
Logins keep default INHERIT (inherit group grants; match `TO group` policies — validated 1.10; public login inherits view-only SELECT, validated 1.24). Never use `postgres`/service-role for requests. Full provisioning + verification: [ownership procedure](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md) §6.

### 6.4 Target-side verification checklist (owner gate, G1)
Run the exact catalog assertions in **[AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md) §7** (view ownership, owner NOSUPERUSER/NOBYPASSRLS, base-table ownership, definer security mode, effective grants, public-login negative test). Summary: Migration ledger matches `0001`–`0009`; effective grants incl. PUBLIC/default privileges (`aura_public`: SELECT on the five discovery views only, zero base-table grants); `aura` not exposed via PostgREST; direct PostgREST anon/authenticated reads of private tables denied and only approved projections readable; **definer view ownership verified in the catalog: the five public views + `slug_redirects` owned by the catalog table owner, owner `rolsuper=false` and `rolbypassrls=false`, owner owns every base table read, no `security_invoker` reloption on the definer views**; definer function owners/search_path pinned; `relrowsecurity` on all tenant tables; non-superuser request logins; negative direct-SQL test as `aura_public_login`.

## 7. Test plan

### 7.1 Executed during planning (evidence)
- `validation/phase-4/validate.ts` — **97/97 pass** on PGlite 0.5.16 / PostgreSQL 18.6 after replaying real `0001`–`0007` + proposed 0008/0009: roles/zero-base-grants/EXECUTE/definer-view/**ownership + ownership-procedure proofs** (1.1–1.24), anonymous reads & negative paths incl. the exact API list query + **search/attribute/sort** (2.1–2.20), **defense-in-depth simulated-grant negatives** (2.21–2.29), suspension lifecycle/four-eyes/freeze/restore/note-confidentiality (3.1–3.25), slug backfill/redirects/rollback/drift (4.1–4.14), limiter isolation (5.1–5.3), double replay (6.1–6.2). Log: `validation/phase-4/results/sql-validation.log`.
- `validation/phase-4/cursor.test.ts` — **16/16 pass** (owner item 2): cursor contract (round-trip, tamper, mismatched route/search/filters/sort/limit, malformed, attr-order independence) + PGlite pagination coverage (no duplicates/omissions) for newest/title/search. Log: `validation/phase-4/results/cursor-tests.log`.
- `validation/phase-4/probe-app.ts` — **9/9 pass** on the real Express app + disposable DB: no-store defect confirmed (A.3), anonymous GET compatibility (A.2/A.4/A.9), cross-site mutation refusal (A.5), uniform API 404 (A.6/A.7), seller auth requirement (A.8). Log: `validation/phase-4/results/app-probe.log`.
- Baseline regression: `pnpm check` clean; **18 files / 294 tests pass**; build OK; **browser suite 3/3 pass, 0 fail, 0 skipped** (`validation/phase-4/results/browser-baseline.log`).
- Two design defects were found by execution and fixed in the proposal: (a) public reads failed on helper-calling PUBLIC policies → `ALTER POLICY … TO aura_app` (T-01); (b) `catalogue_suspension_guard` referenced `old.status` on child tables (SQL AND does not short-circuit) → nested IFs; plus trigger-ordering refinement for atomicity errors.

### 7.2 Proposed implementation tests (to be written in the phase)
- `tests/migrations.test.ts` extensions: 0008/0009 replay, catalog assertions (roles, zero base grants, definer views, **view owner + owner attributes (nosuperuser/nobypassrls) + security mode + effective grants**, policy scoping, function EXECUTE, note-accessor grant, indexes, triggers re-enabled).
- `tests/storefront-cursor.test.ts`: port the executed `cursor.test.ts` cases against the implementation module (contract + pagination coverage).
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
6. `no-store` on every API response; signed cursors tamper-evident **and bound to route/search/filters/sort/limit with a sort-consistent keyset** (no duplicates/omissions); public limiter isolated; trusted-proxy default off.
6a. **Discovery works:** search, category + attribute filtering, and selectable sorting return correct results using only the D-02 allowlist; user-facing menus confirmed via D-23/D-24/D-25.
6b. **Definer ownership explicit:** the five public views are owned by a non-superuser, NOBYPASSRLS catalog owner that owns the base tables; catalog assertions pass; `aura_public` has zero base grants.
6c. **Defense-in-depth:** public product/child/redirect policies enforce approved seller + no suspension; simulated-base-grant negative tests hide suspended/unapproved sellers across all child tables.
7. Preview configurators/cart/wishlist/containment unchanged; full baseline regression (294+) plus new suites green in hosted CI; no skipped/weakened mandatory tests.
8. Docs consistent; phase report separates executed vs proposed evidence; no production-readiness claim.

## 9. Implementation sequence (after authorization)

0. Database ownership prerequisite per [AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md](AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md) §§2–4 (catalog owner, base-table ownership, executor privileges/membership), verified at G1.
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
