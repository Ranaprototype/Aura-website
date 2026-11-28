# Phase 4 — Independent Final Review

**Scope:** rigorous review of the actual working-tree changes before any publish.
**Approvals in force:** D-22 (implementation authorized), D-23 (title+summary word
search), D-24 (newest default + title A–Z), D-25 (category + curated attribute
filters); D-01–D-04 unchanged. Reference package `476a90a`.

> **Verdict:** the Phase 4 implementation is complete and verified in the isolated
> PGlite/Express/Chromium environment. Two defects were found and **fixed** this
> session (a public-limiter deviation from the approved plan, and a marketplace
> browser-test flake with an underlying client fetch race). No HIGH/CRITICAL
> security defect remains. **Phase 4 is NOT production-ready** — G1 (real
> PostgreSQL/Supabase verification) is a separate, still-pending deployment gate.
> **No commit, push, PR, merge or deploy was performed; `master` is unchanged.**

---

## 1. Git / branch integrity

| Item | Value |
| --- | --- |
| Current branch | `arena/091f37f6-aura-website` (platform-fixed) |
| Local HEAD | `b12a5596bf3b454b844c5d3b5bc83784247e300f` |
| `master` (remote, authoritative) | `b12a5596bf3b454b844c5d3b5bc83784247e300f` — **unchanged** |
| Remote branch tip | `476a90a6edf59a6b3bfb733b48d6f27a011a2bc0` (no push this session) |
| Staged | **nothing** (`git diff --cached` empty) |
| `git diff --check` | **clean** (no whitespace/conflict markers) |
| Modified tracked files | **18** |
| Untracked entries | **14** (implementation + 2 evidence directories) |

**Branch anomaly (reported, not "fixed"):** the sandbox was re-cloned fresh, so the
local branch sits at the base commit `b12a5596` while the remote branch tip is the
previously published review package `476a90a` (object absent locally). All
implementation and review work is **uncommitted/untracked** in the working tree.
No reset/checkout/commit was performed — no git write action is authorized.

**Review-only vs implementation mixing:** YES, they are mixed in the working tree.
`phase-4-review-materials/` (the published reference package) and
`phase-4-implementation-evidence/` (this session's logs) are untracked alongside the
implementation files. They are deliberately kept separate directories; none is
staged. The review package was re-verified **byte-identical** to `476a90a`
(`sha256sum -c SHA256SUMS.txt` → all OK; 24/24 blobs match, 0 mismatch/missing/extra).

**Unrelated changes / accidental generated files:** none. The only gitignored
generated path present is `phase-4-review-materials/validation/phase-4/results/`.
The temporary review probe (`.review-probe.mjs`) was **deleted** after its output
was preserved to `independent-db-probe.log`. `node_modules/`, `dist/`, and
`/tmp/al2023` are environment-only and excluded from snapshots.

### Modified tracked files (18)
`client/src/App.tsx`, `client/src/index.css`, `client/src/lib/marketplace.ts`,
`client/src/pages/AdminReviewPage.tsx`, `package.json`, `server/app.ts`,
`server/config.ts`, `server/modules/marketplace/{helpers,review,schemas,seller}.ts`,
`server/services.ts`, `shared/marketplace.ts`, `shared/routes.ts`,
`tests/marketplace-ui.test.tsx`, `tests/migrations.test.ts`,
`tests/support/{app,database}.ts`.

### Untracked implementation
`client/src/lib/storefront.ts`, `client/src/pages/Marketplace{,Product}Page.tsx`,
`server/modules/storefront/{cursor,index,limits,public,schemas}.ts`,
`shared/storefront.ts`, `supabase/migrations/0008_public_storefront.sql`,
`supabase/migrations/0009_global_product_slugs.sql`,
`supabase/rollback/rollback_0009_global_product_slugs.sql`,
`tests/{browser-marketplace.mjs,storefront-api.test.ts,storefront-cursor.test.ts,storefront-limits.test.ts}`.

---

## 2. Findings — severity-ranked

### MEDIUM — Public limiter deviated from approved plan §3.4 (FIXED)
**Where:** `server/modules/storefront/limits.ts`, `server/config.ts:89`.
**What:** four deviations from the owner-approved plan §3.4:
1. Bucket was the **raw client IP** (`ip:${ip}`) instead of a hashed
   `sf:<sha256(ip)[:32]>` — retained raw addresses in a table the public pool can
   read (privacy minimization gap).
2. Default budget was **120/min** instead of the approved **240/min**.
3. **No pruning** of windows older than one hour → unbounded table growth.
4. **No fallback** on limiter query failure → a limiter outage became a full
   browsing outage (the plan requires "never unlimited, never a full browsing
   outage").

**Fix:** rewrote `limits.ts` —
`publicBucket()` hashes the IP (`limits.ts:26`); `prunePublicLimits()` deletes
windows older than 1 h (`limits.ts:58`), throttled to once/min/instance on the
consume path (`limits.ts:93-96`); `fallbackHit()` is a bounded per-instance
in-memory counter with the **same** limit (`limits.ts:34`, cap 10 000 buckets at
`limits.ts:32`); `consumePublicRead()` falls back + warns on any limiter failure
(`limits.ts:99-104`). Default aligned to 240 (`config.ts:90`). The warning is wired
to the structured logger in `server/modules/storefront/public.ts:206-211`.
**Verification:** new `tests/storefront-limits.test.ts` (5 tests) — hashing/no raw
address, window increment + over-limit denial with Retry-After, 1-hour pruning,
fallback keeps the exact budget + warns (never unlimited), per-IP fallback
isolation. Full suite re-run green (§6).

### LOW — Marketplace browser test flake + client stale-fetch race (FIXED)
**Where:** `tests/browser-marketplace.mjs:148` (assertion),
`client/src/pages/MarketplacePage.tsx:26-43` (fetch).
**What:** after an in-page filter change the previous grid is still mounted, so a
bare `waitFor()` resolved against stale content (or caught the loading unmount and
read **0 cards**). Reproduced **2 of 3 failures** (`0 !== 1`). Separately, the page
had **no stale-fetch cancellation**, so rapid search/category/sort changes could
let a slow earlier response overwrite a newer one.
**Fix:** the test now waits for the *expected* grid state via a retrying
`waitForFunction` (`browser-marketplace.mjs:141-160`, used at 167/172/174/179);
the page gained a request-sequence guard so only the latest fetch applies its
result (`MarketplacePage.tsx:29-35`).
**Verification:** **5 consecutive passing** storefront browser runs after the fix
(was 2/3 failing); baseline browser suite still 3/3.

### INFO — Cursor has no expiry TTL (reviewed, not a defect)
**Where:** `server/modules/storefront/cursor.ts`.
The review checklist mentions "expiry"; the **approved plan §3.3 contract has no
TTL**, and none was added (adding one would be an unapproved product change). This
is safe: a cursor carries only a public keyset position (`approvedAt`/`slug` or
`title`/`slug`) plus a binding hash; **all filters and the publication predicate
are re-applied server-side on every request** (`public.ts:37-82`), so a stale
cursor cannot bypass the boundary or expose non-public data. Tampering, wrong
version, malformed payloads and binding mismatch are all rejected with
`invalid_cursor` (`cursor.ts:76-122`, constant-time compares). Optional future
hardening (TTL) is left to the owner as a separate decision.

### No HIGH / CRITICAL findings
The core security boundaries were empirically verified (§3–§5): zero base-table
grants to `aura_public`, SECURITY DEFINER discovery views owned by a
non-superuser/NOBYPASSRLS role, publication boundary, four-eyes on suspend **and**
restore, confidential-note access control + audit non-leak, isolated limiter
storage, fully parameterized SQL, uniform 404, `no-store` on every response code,
fail-closed 503, and trusted-proxy default OFF.

---

## 3. Database security (verified — independent probe 31/31)

Evidence: `independent-db-probe.log` (full ledger `0001`–`0009` replayed **twice**).

- **Zero base-table grants:** `aura_public` SELECT denied on every catalog base
  table (22 checked); the only intentional grant is the isolated
  `aura.public_rate_limits` (§5). `has_table_privilege('aura_public','aura.products','SELECT')`
  = **false**; on `aura.public_products` = **true**.
- **Definer views:** all five `public_*` views owned by `aura_catalog_owner`;
  `public_products` has **no** `security_invoker` (definer); `storefront_products`
  remains `security_invoker=true` and is **not** granted to `aura_public`.
- **Owner role posture:** `aura_catalog_owner` is `NOSUPERUSER`/`NOBYPASSRLS`/`NOLOGIN`
  and owns every base table the views read. No `FORCE ROW LEVEL SECURITY` on aura
  tables. `aura_public` has **zero** EXECUTE on aura functions.
- **Publication boundary:** `public_products` shows only approved + published
  products; a suspended seller's product is hidden; direct base SELECT as
  `aura_public` is denied.
- **Four-eyes both directions:** an insider (the reviewing admin) is blocked from
  **restoring** *and* from **suspending** their own org (`review_separation_required`).
- **Note confidentiality:** the owner reads the suspension note only via the
  role-checked SECURITY DEFINER accessor (`search_path=pg_catalog, aura`); a viewer
  is denied; `aura_public` cannot execute it; the note text is **absent** from the
  member-readable audit trail (audit records `{noteRecorded}` only).
- **Limiter isolation:** the PUBLIC role has no privilege on `public_rate_limits`;
  only `aura_public` (the server pool) has CRUD.
- **0009 global slugs:** earliest product keeps its slug; later duplicates get a
  deterministic id-derived suffix; a `global_collision` redirect is recorded; the
  global unique **index** `products_slug_global_key` exists; replay does **not**
  rename again. **Rollback** restores the original slug, removes only collision
  redirects, and **aborts on drift** (`slug_redirect_rollback_conflict`, 23505)
  with the drifted slug untouched — no silent data destruction.

---

## 4. Server security (verified)

- **Public field allowlist:** `shared/storefront.ts` exposes only slug-keyed
  discovery fields (title, summary, description, category, approvedAt, variants,
  media, attributes). **No** internal org/product/revision ids, seller identity,
  SKU, price, stock or checkout fields.
- **Anonymous boundary:** `attachSession` does no DB work without a cookie;
  `csrfGuard` passes safe GET methods; the public router is GET-only and mounted
  last (`server/app.ts:69-72`).
- **Pool isolation + fail-closed:** reads run on the separate `publicDb`
  (`server/services.ts:65-66`); absent **or** unreachable pool ⇒ `503
  storefront_unavailable`, never an app-pool fallback (`public.ts:175-224`). Close
  order is email → publicDb → db (`services.ts:119-122`).
- **Cursor:** HMAC-SHA256, bound to route+q+category+attr(sorted)+sort+limit,
  constant-time signature and binding compares, version/shape checks
  (`cursor.ts`). Ephemeral 32-byte secret in dev/test; production requires
  `PUBLIC_CURSOR_SECRET` when the public surface is enabled (`config.ts`).
- **Input validation:** `schemas.ts` enforces q ≤ 100, curated facet keys only
  (≤ 8 attrs), limit 1–60 (default 24), slug regex; every filter is re-applied
  server-side. **All SQL is parameterized** (`$n`); the only interpolated tokens
  are fixed ORDER BY literals and placeholder indices — no injection surface
  (`public.ts:37-82`).
- **Rate limiting + trusted proxy:** isolated per-IP fixed-window limiter (now
  plan-compliant, §2); `trust proxy` defaults **OFF** so a spoofed
  `X-Forwarded-For` cannot evade the budget (`app.ts:45`, `config.ts`).
- **Uniform 404 + cache headers:** malformed slug and missing product both return
  the same `404 not_found` (`public.ts:255-269`); `Cache-Control: no-store` is set
  on **every** `/api` response by middleware mounted **before** the v1 routers
  (`app.ts:38-41`, fixing the Phase 3 mount-after defect), confirmed on
  200/400/404/429/503 by `storefront-api.test.ts`.
- **Error/logging leakage:** the public envelope is `{error: <code>}` only — no
  stack, SQL or internals (`http/errors.ts`); `RequestError` is mapped locally in
  the public handler (`public.ts:221`) so it never falls through to a 500.

---

## 5. Frontend / product (verified)

- **Approved-only content:** the client renders only what the public API returns
  (approved products from approved, non-suspended sellers); suspension hides the
  seller's products and the detail page shows the uniform "Product not found."
- **No private identifiers / commerce claims:** grep of the new client files found
  **no** org/product/revision/seller/principal ids and **no**
  checkout/purchase/stock/manufacturing/price copy (the only "checkout" matches are
  reused CSS layout class names). The detail page is discovery-only (About /
  Specifications / Options / Back).
- **HOLO preserved:** `/products/:slug` still renders `GenericConfigurator` and
  `/product/sneaker` is untouched (`App.tsx:83,108`); the new routes are additive
  (`/marketplace`, `/marketplace/product/:slug`) and the SPA allowlist was extended
  without a public seller route (D-21 stays separate).
- **Search/filter/sort/pagination/detail:** verified in real Chromium — word
  search (D-23), category + curated attribute filters (D-25), newest/title sort
  (D-24), signed-cursor "Load more", detail + legacy-slug live-first redirect.
- **Suspension controls admin-restricted:** the Suspension tab is gated on
  `session.platformAdmin` (`AdminReviewPage.tsx:91`) with an explicit note that
  authority is enforced by the database, not the browser role; the server
  re-checks `requirePlatformAdmin` + four-eyes on every suspend/restore.

---

## 6. Verification — commands and actual results

All logs are in `phase-4-implementation-evidence/` (refreshed this session).

| Command | Actual result | Log |
| --- | --- | --- |
| `corepack pnpm check` (`tsc --noEmit` ×2) | **0 errors** | `check.log` |
| `corepack pnpm test` (vitest, PGlite + Express) | **21 files / 338 passed, 0 failed** (82.60 s) | `test.log` |
| `corepack pnpm test:browser` (baseline, preserved) | **3 passed, 0 failed, 0 skipped** | `browser-baseline.log` |
| `corepack pnpm test:browser:storefront` (new) | **1 passed, 0 failed**; **5/5 consecutive** stress runs | `browser-storefront.log` |
| Independent DB probe (PGlite, ledger ×2) | **31 passed, 0 failed** | `independent-db-probe.log` |
| `git diff --check` | **clean** | — |

Test count: baseline 294 + Phase 4 **44** (storefront API 24, cursor 11, limiter 5,
migrations posture 4) = **338**. Browser runs use the `@sparticuz/chromium` NSS
workaround (`LD_LIBRARY_PATH=/tmp/al2023/lib`) against a fresh `vite build` served
from `dist/public`. The three baseline browser suites are unchanged; the new
marketplace suite is reported separately. **These are actual executed logs, not
prior summary claims.**

---

## 7. Remaining risks / production-only verification

- **G1 (deployment gate, still pending):** real PostgreSQL/Supabase verification of
  role ownership, *effective* grants, PostgREST exposure and the public-login
  negative test, per `AURA-PHASE-4-DATABASE-OWNERSHIP-PROCEDURE.md` §7. PGlite
  proves semantics only; it does not prove the hosted grant/role state.
- **Limiter fallback is per-instance:** under a DB outage each instance keeps its
  own bounded counter, so the effective global budget scales with instance count
  until the DB recovers. This matches the plan's "never unlimited, never a full
  outage" intent; a shared fallback store would be a future hardening decision.
- **0009 index build:** `CREATE UNIQUE INDEX` runs inside the migration transaction
  (fine at current catalogue scale); a large-table deployment must schedule
  `CREATE UNIQUE INDEX CONCURRENTLY` outside the transaction (noted in `0009`).
- **Cursor TTL:** intentionally absent per the approved contract (§2 INFO); optional
  future hardening is an owner decision.
- **Hosted CI browser gate:** the sandbox NSS workaround is environment-only;
  hosted CI (`google-chrome`) remains the authoritative browser gate.

---

## 8. Working-tree / branch status and publish confirmation

- Branch `arena/091f37f6-aura-website`, HEAD `b12a5596…`; **18 modified + 14
  untracked**, **nothing staged**, `git diff --check` clean.
- `master` reverified **unchanged** at `b12a5596bf3b454b844c5d3b5bc83784247e300f`
  (`git ls-remote origin master`).
- Remote branch tip still `476a90a…` — **no push** occurred.
- **No commit, push, pull request, merge or deploy was performed.** All changes
  remain in the working tree, awaiting separate explicit authorization.
- Review package `phase-4-review-materials/` re-verified byte-identical to
  `476a90a` (`sha256sum -c SHA256SUMS.txt` → all OK).

**Phase 4 is not described as production-ready.** G1 remains a separate deployment
gate and was not used to delay isolated development/testing.
