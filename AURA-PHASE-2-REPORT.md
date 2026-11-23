# AURA Phase 2.2 report · Engineering completion and verification

**Disposition: implementation complete and verified locally; not released, not deployed, not pushed, and not a claim of production readiness.** Every check below was executed on the working tree in this repository against disposable local services only. Nothing was run against a shared or production database, and no email left the machine. Phase 3 has not been started and `master` is untouched.

- Baseline commit: `fd1edeede19e9edbb48f08e2b060165933ced974` (`master`, unchanged)
- Working branch: `arena/0b6d49f9-aura-website`, HEAD still `fd1edee…` — all Phase 2 work is uncommitted working-tree state awaiting human review
- Changed paths: 11 modified, 24 added (files listed in [Delivery review](#delivery-review))
- Categories used throughout: **Implemented**, **Tested-passed**, **Tested-failed**, **Blocked**, **Requires-owner-config**

## 1. Exact verification results

Run from the repository root with Node 22.22.3 / Corepack pnpm 10.34.9, on 2026-11-22.

| Command | Result | Exit |
|---|---|---|
| `corepack pnpm check` (`tsc --noEmit` + `tsc -p tsconfig.node.json`) | No type errors in `server/`, `shared/`, `client/`, `tests/` | 0 |
| `corepack pnpm test` (Vitest) | **14 files, 220 tests passed, 0 failed, 0 skipped** (≈100 s) | 0 |
| `corepack pnpm build` | `dist/public` + `dist/index.js` (80.1 kB) produced | 0 |
| `CHROMIUM_PATH=… corepack pnpm test:browser` | **2 files, 2 tests passed, 0 failed** (`browser.mjs` ≈4 s, `browser-auth.mjs` ≈36 s) | 0 |
| `corepack pnpm install --frozen-lockfile --ignore-scripts` | "Already up to date" — lockfile matches `package.json` | 0 |
| `git diff --check` | No whitespace/conflict artefacts | 0 |

Per-file Vitest inventory (all passing):

| Suite | Tests | Evidence produced |
|---|---|---|
| `tests/auth-api.test.ts` | 26 | HTTP contract for register/login/session/logout/verify/resend/forgot/reset/supabase, CSRF, origin, cookie flags, lockout, session expiry, registration ceiling |
| `tests/workspace.test.ts` | 9 | Organizations, invitations, role changes, revocation, last-owner rule, projects, platform-admin overview |
| `tests/tenant-isolation.test.ts` | 21 | Tenant/RLS runtime behaviour over a socket-backed PostgreSQL instance |
| `tests/email.test.ts` | 37 | Seven templates, rendering, delivery, failures, retries, idempotency, rate limits, log hygiene |
| `tests/supabase-identity.test.ts` | 11 | Token verification against a loopback fake issuer; fail-closed variants |
| `tests/config.test.ts` | 18 | Config validation, production fail-closed matrix, no secret echo |
| `tests/migrations.test.ts` | 8 | Migration replay, RLS/policy/role/privilege catalogue checks |
| Phase 0/1 regression suites (`api`, `adapter`, `routing`, `containment`, `wishlist`, `cart`, `migration`) | 90 | Unchanged behaviour: storefront containment, diagnostics, adapter, migration replay |

Phase 0/1 baseline of 90 tests is preserved exactly; 130 tests were added in Phase 2 (120 through 2.1 plus 10 in 2.2). No test was skipped, marked `todo`, or weakened to obtain a pass.

## 2. Implemented

**Identity and sessions** — `server/auth/{password,identity,tokens,store}.ts`, `server/db/database.ts`, `server/http/{cookies,logger}.ts`, `server/modules/{auth,authorized}.ts`, migrations `0002_identity.sql`, `0004_roles.sql`.

- scrypt password hashing with per-user salt and constant-time compare; no plaintext or reversible password storage
- opaque session tokens: only a SHA-256 hash is stored in `aura.sessions`; cookie `aura_session` is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production
- single-use, hashed email tokens for verification and password reset, with expiry, reuse rejection and revocation of other sessions on reset
- CSRF double-submit (`aura_csrf` cookie + `x-aura-csrf` header) plus an equality check against the session hash; origin allowlist that fails closed
- rate limiting through `aura.auth_rate_limits` (registration ceiling, login per IP and per email, password-recovery per email, resend ceiling) with generic responses and generic lockout copy
- named authorization helpers as required by the review checklist: `requireOrganization`, `requireRole`, `requirePlatformAdmin` (`server/modules/authorized.ts`), all resolving through one `authorized()` transaction that binds `aura.principal_id` and `aura.organization_id` before any query
- platform administration is a database grant in `aura.platform_admins`; there is no environment switch, header or query parameter that elevates a principal
- optional Supabase token login (`/api/v1/auth/supabase`) verifies the token server-side against the configured issuer (`/auth/v1/user`, `apikey` header, bounded timeout, size and strict JSON/shape validation); unconfigured ⇒ `501 identity_provider_unavailable`
- no diagnostic bypass: the Phase 0 operator token remains a diagnostics gate only and grants no identity; nothing in `server/` contains a test-mode auth path (`grep` for `testMode|bypass|skipAuth|DISABLE_AUTH` returns nothing)

**Tenancy** — `0002_identity.sql`, `0004_roles.sql`, `server/modules/workspace.ts`, `server/db/database.ts`.

- every tenant table has RLS enabled and policies scoped through `aura.current_principal()` / active membership
- the runtime connects as `aura_app`: `NOSUPERUSER`, `NOBYPASSRLS`, `NOLOGIN` (assumed via `set local role`), owns no object, holds `SELECT`-only on `organizations`/`memberships` and no `EXECUTE` for `PUBLIC` on the security-definer functions
- privileged mutations go through security-definer functions with `search_path=pg_catalog, aura` (`create_organization`, `set_member_role`, `revoke_membership`, `accept_invitation`, `org_members`, `is_active_member`), so promotion, revocation and invitation acceptance cannot be performed by direct table writes
- last-owner protection and role authority rules live in the database (`23514` / `42501` mapped to `409 last_owner` / `403 role_forbidden`), not only in the route layer

**Email** — `server/email/{templates,transport,service}.ts`, migration `0003_email.sql`.

- seven transactional templates: verify-email, welcome, password-reset, organization-invitation, role-changed notice, access-revoked notice, session-security notice; each with HTML and plain-text bodies
- delivery through an SMTP URL (local test service in this phase), bounded attempts, exponential backoff, `aura.email_events` idempotency keys, per-recipient rate limits, and a redacting logger
- send is deferred with `after:` so no provider call happens while a database connection is held

**Client** — `client/src/lib/api.ts`, `pages/AuthPages.tsx`, `pages/WorkspacePage.tsx`, `App.tsx`, `index.css`, `shared/routes.ts`.

- sign-in, register, forgot-password, reset-password, verify-email, accept-invitation and workspace routes added to the SPA; the existing HOLO storefront routes and visual identity are untouched
- all requests are same-origin relative URLs with `credentials: "include"` and the CSRF header; no token is stored in `localStorage`

**Composition** — `server/{services,app,index,config}.ts`.

- `createServices(config)` builds pool-backed services; without a database the app still serves the storefront and reports `503` readiness instead of fabricating identity
- production config is fail-closed: `DATABASE_URL`, `APP_ORIGIN`, `SMTP_URL` (with TLS), `EMAIL_FROM` and secure cookies are required; production database URLs must not disable TLS

## 3. Tested — passed

### 3.1 PostgreSQL runtime behaviour (real PostgreSQL engine, disposable instance)

Method: embedded PGlite (PostgreSQL 17-compatible WASM build) started fresh per suite, migrations applied from `supabase/migrations/`, exposed over loopback TCP with `pglite-socket`, consumed by the real `PgDatabase` pool (`max: 4`, `role: "aura_app"`). Every suite creates its own throwaway instance; nothing touches a shared server. The PGlite instance is discarded at teardown.

| Required check | Where | Result |
|---|---|---|
| RLS enforced for tenant tables | `tenant-isolation.test.ts`, `migrations.test.ts` | pass — policies present on all four tenant tables; unbound reads return no rows |
| Cross-organization denial | `tenant-isolation.test.ts`, `workspace.test.ts` | pass — GET/POST/DELETE of another org's resources ⇒ `403 organization_forbidden`, no row created |
| Forged identity rejected | `tenant-isolation.test.ts`, `auth-api.test.ts` | pass — `x-aura-principal`/`x-aura-org` style hints are ignored; strict bodies reject unknown identity fields with `400 invalid_request` and write nothing; forged/foreign org id ⇒ `403` |
| Missing identity rejected | `auth-api.test.ts`, `workspace.test.ts` | pass — no cookie ⇒ `401 authentication_required`; cookie without org ⇒ `400 organization_required`; unknown/garbage cookies ⇒ `401` |
| Membership revocation takes effect | `workspace.test.ts` | pass — after `revoke_membership` the same live session gets `403 organization_forbidden`, `memberships.status = 'revoked'` with `revoked_at` set, and a notice email is produced |
| Pooled-connection identity isolation | `tenant-isolation.test.ts` | pass — requests from two tenants interleaved over the shared pool never observe each other's rows; identity is set per transaction with `set local` and cleared by commit/rollback |
| Invitation policy | `workspace.test.ts` | pass — viewer cannot invite; email mismatch ⇒ `400`; duplicate live invite ⇒ `409 invitation_exists`; revoked/expired or already-accepted invite cannot be reused; accepting with another account's email is refused |
| Privilege escalation prevented | `workspace.test.ts`, `migrations.test.ts` | pass — member cannot self-promote ⇒ `403 role_forbidden`; admin cannot create an admin; last owner cannot be removed ⇒ `409 last_owner`; runtime role has no direct write grants and no `PUBLIC` function execute |
| Session expiry enforced | `auth-api.test.ts` | pass — after `expires_at` passes, an unexpired cookie yields `401 authentication_required` |

### 3.2 Browser verification (real Chromium via Playwright, built SPA)

`tests/browser-auth.mjs` drives the **built** application in a fresh Chromium context at an ephemeral loopback port, with all external requests aborted and a captured `pageerror` list asserted empty.

Executed steps, all passing: storefront pages render unchanged with cart/wishlist intact · `/workspace` redirects an anonymous visitor to `/sign-in` · registration creates an account and lands in the workspace · an unverified account is refused a write with `403 email_unverified` · the verification link taken from the actual local SMTP message activates the account · reload restores the session and a created project persists across reload · logout revokes the session and replaying the old cookie is refused · wrong password shows "That email and password combination was not accepted." and the right one signs in · password recovery mail is delivered and the reset link sets a new password while the old password is refused · replaying the consumed reset link is refused with "That link is invalid, already used or expired." · zero page errors.

### 3.3 Email behaviour (local SMTP test service only)

`tests/email.test.ts` runs a test-owned `smtp-server` sink on loopback; no external mail is sent and no provider account exists.

- all seven templates render HTML and plain text, with the token present in the link and absent from the plain-text subject/body leaks
- valid local delivery, invalid recipient address rejected before send, failed delivery recorded, retry with backoff up to `EMAIL_MAX_ATTEMPTS`, then terminal `failed` state
- idempotency: repeating the same action within the window does not send duplicate mail; a duplicate invitation is refused at the database before any send
- per-recipient rate limiting: recovery and resend ceilings produce the same generic HTTP response, with no address enumeration
- logger redaction: tokens, SMTP URL and credentials never appear in captured log output; a source sweep asserts no SMTP credential literals exist in the repository
- a stalled/failing SMTP server cannot delay the HTTP response: the send happens post-commit via `after:`

### 3.4 Security re-check against the Phase 2 checklist

| Requirement | Status | Evidence |
|---|---|---|
| `requireOrganization()` | pass | exported helper; `/projects` GET; `workspace.test.ts`, `auth-api.test.ts` |
| `requireRole()` | pass | exported helper; projects write/delete and member/invitation routes; role matrix asserted |
| `requirePlatformAdmin()` | pass | exported helper; `/admin/overview` ⇒ `403` for a normal owner, `200` after an `aura.platform_admins` grant |
| CSRF | pass | cookie+header double submit, mismatch ⇒ `403 csrf_failed`; asserted in `auth-api` and exercised by the browser flow |
| Session revocation | pass | logout, password reset and membership revocation invalidate access immediately; cookie replay refused in Chromium |
| Cookie security | pass | `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` asserted under production config; no token in JS-readable storage |
| Supabase identity verification | pass | server-side issuer call, strict shape/status/MIME/timeout checks, no trust in browser assertions; `501` when unconfigured |
| No diagnostic bypass | pass | operator token gates diagnostics only; 401/403 matrix unchanged from Phase 0 |
| No production test-mode auth | pass | source sweep for bypass/test-mode switches returns nothing; test doubles live only under `tests/` |

## 4. Tested — failed (found and fixed during this phase)

Recorded for accuracy; **none of these remain failing** in the final run.

1. `500` on logout/resend/login-adjacent routes — nested pool queries inside an open transaction exhausted the pool (`max: 4`) and surfaced as a generic connection-timeout error. Fixed by threading the request `Transaction` (`Queryable`) through `server/auth/store.ts` and all call sites; no store method opens a pool query while a transaction is held.
2. `500 "Called end on pool more than once"` when two apps shared one database in a suite — `PgDatabase.close()` is now idempotent.
3. `500` on last-owner removal — PostgreSQL `23514` was unmapped. Now `409 last_owner`; `42501` ⇒ `403 role_forbidden`, `P0002` ⇒ `404 membership_not_found`.
4. Browser registration `403 origin_rejected` — the test harness bound an ephemeral port while asserting a fixed `APP_ORIGIN`. The harness now reserves the real port and derives `APP_ORIGIN` from it; the production origin check was **not** relaxed.
5. `429 rate_limited` during the verification run — the registration ceiling (correctly) counted every account in the suite. Limits are now configurable with production defaults and asserted by a dedicated low-limit test proving `201, 201, 429` and that no row is written on the refused attempt.
6. One Phase 0 regression risk: `attachSession` originally mounted after the `/api` 404 catch-all, which would have swallowed `/api/v1`. Mount order was corrected and is covered by the existing API suite.

## 5. Blocked / not verified

These are honest gaps. They are **not** covered by the results above.

| Item | State | Reason |
|---|---|---|
| Deployed Supabase/PostgreSQL verification (actual RLS enforcement, actual grants, PostgREST exposure of `aura`) | **BLOCKED** | No project credentials are available and the task forbids using a shared/production database. Evidence comes from replaying the migrations in a disposable PostgreSQL-compatible engine, not from a deployed instance. |
| Multi-process / true concurrent pooling under load | **BLOCKED** | PGlite is a single-process WASM PostgreSQL; pool exhaustion and per-transaction identity are reproduced, but contention, deadlock detection and `pg_stat_activity` behaviour under many real backends are not. |
| Email deliverability (SPF/DKIM/DMARC, provider reputation, bounce handling, inbound replies) | **BLOCKED** | No domain, DNS control or provider account; outbound delivery outside the machine was not attempted. |
| Production TLS mail path | **BLOCKED** | Only a local plaintext sink was available; the TLS-required branch is config-validated but not exercised against a real TLS relay. |
| Hosted CI execution of these changes | **BLOCKED** | Work is uncommitted on an unpushed branch; the Phase 0 workflow definition is unchanged and was not run for Phase 2. |
| Load, penetration, accessibility and cross-browser audits | **BLOCKED** | Out of scope for this phase; Chromium-only coverage is stated as such. |

## 6. Requires owner configuration before any real use

1. `DATABASE_URL` for a login that is the non-owner `aura_app` role (not a superuser, not the table owner, no service-role key), with a real password and TLS in production.
2. Apply `0002`–`0004` to the target database through the approved migration process, then verify role membership, grants and `relrowsecurity` on the deployed instance (this report cannot).
3. `APP_ORIGIN` set to the real public origin; the check fails closed when it is absent in production.
4. `SMTP_URL` (TLS-enabled relay) and `EMAIL_FROM` on a domain the owner controls, with SPF/DKIM/DMARC configured, plus a decision on the support address used in templates.
5. If Supabase token login is wanted: `SUPABASE_URL` + `SUPABASE_ANON_KEY` (publishable key only, server-side) and a decision about which identity provider is authoritative.
6. Platform administrators must be granted explicitly in `aura.platform_admins`; there is no environment shortcut by design.
7. Decisions outstanding: session TTL, cookie policy for subdomains, password policy/rotation, retention and deletion of `aura.email_events` and `aura.auth_rate_limits`, and whether invitation acceptance requires a verified email.

## 7. Delivery review

Scope: `git status`, full diff read, secret sweep, migration and test review, lockfile verification. No commit, push, merge, deployment or `master` change was made.

- 11 modified files: `.env.example`, `client/src/App.tsx`, `client/src/index.css`, `package.json`, `pnpm-lock.yaml`, `server/app.ts`, `server/config.ts`, `server/http/errors.ts`, `server/index.ts`, `shared/routes.ts`, `vitest.config.ts`
- 24 added paths: `client/src/lib/api.ts`, `client/src/pages/{AuthPages,WorkspacePage}.tsx`, `server/auth/*`, `server/db/database.ts`, `server/email/*`, `server/http/{cookies,logger}.ts`, `server/modules/{auth,authorized,workspace}.ts`, `server/services.ts`, `supabase/migrations/000{2,3,4}_*.sql`, `tests/{auth-api,config,email,migrations,supabase-identity,tenant-isolation,workspace}.test.ts`, `tests/browser-auth.mjs`, `tests/support/*`
- no unrelated feature, dependency or workflow change; `package.json` additions are limited to `pg`, `nodemailer` and their types plus test-only `pglite-socket`, `smtp-server`, `playwright-core`/`@sparticuz/chromium` usage already implied by the Phase 0 browser gate
- secret sweep across the full diff and every added file: no live credential, key, JWT, private key or password-bearing connection string; only documented placeholders and `*.example.test` fixtures. No SMTP or database secret is echoed by any code path
- `.env.example` documents the new variables as inert comments; `.env.*` remains ignored except the example
- `git diff --check` clean; generated `dist/` excluded; no debug script left behind
- suggested commit message if the owner accepts this work: `Phase 2: identity, tenancy and email foundation with verification suite`
- **Awaiting human review.** Nothing here should be read as approval to deploy, to point the application at a real database, or to send real email.
