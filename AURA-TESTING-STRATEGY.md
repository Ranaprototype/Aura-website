# Reproducible Phase 0 checks

From the repository root, Node 22.22.3 and Corepack pnpm 10.34.9. No `.env.local`, Supabase account, operator token, payment credential or existing browser profile is required. Never run tests against a shared database.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm check
corepack pnpm test
corepack pnpm build
CHROMIUM_PATH=/absolute/path/to/chromium corepack pnpm test:browser
corepack pnpm audit --json
corepack pnpm audit --prod --json
```

- `tests/containment.test.tsx`: mount the actual SPA at six direct links in an empty jsdom origin. Assert unavailable headings, no input/form/frame, no spoofed identity/order output and no storage method/fetch calls. Do not seed historical data or enter payment details.
- `tests/api.test.ts`: loopback HTTP to Express, synthetic store injection. Config validation, liveness/ready/offline, closed routes, operator positive/negative authorization, origin rejection, size/type/schema validation, generic errors. Store success fixtures are **tests only**; runtime never substitutes them for a database.
- `tests/adapter.test.ts`: real Express router, production adapter and installed Supabase SDK against a test-owned loopback HTTP responder. Fail closed for upstream status, MIME, shape, timeouts and insert mismatches. No external database or mocked store in this suite.
- `tests/routing.test.ts`, `tests/cart.test.ts`, `tests/wishlist.test.tsx`: document/asset/service boundaries, shared port settings, applied preview estimates and safe local wishlist handling. Chromium also checks the newsletter section has no form, and drawer/page totals agree after a discount.
- `tests/migration.test.ts`: replay the original migration twice in fresh in-memory PGlite. Check records survive replay, RLS enabled, missing grants deny reads, explicit test grants permit unscoped read/insert, delete remains denied. No external DB and no migration edits.
- `tests/browser.mjs`: a real Chromium executable is required, not silently skipped. A fresh context at a mobile viewport opens the built SPA on ephemeral loopback. Blocks external requests. Exercise catalog → configurator → local cart → unavailable checkout, forged order/account links, unknown page and unconfigured diagnostics; assert no page errors. No screenshots or persistent profiles. This is smoke coverage, not a complete accessibility or cross-browser audit.
- `.github/workflows/phase-0.yml`: PR-only, read-only CI definition; frozen install, typecheck including tests/config, test, build, browser smoke, high-severity audit gate. No deployment or database secrets. Hosted execution is pending an authorized PR.

## Phase 2 additions (identity, tenancy, email)

Same commands as above; `corepack pnpm test` now also runs the Phase 2 suites and `corepack pnpm test:browser` runs two browser files. Phase 2 results and their limits of evidence are recorded in [AURA-PHASE-2-REPORT.md](AURA-PHASE-2-REPORT.md).

- `tests/support/database.ts`: one disposable PostgreSQL instance per suite — embedded PGlite, real migration files applied, exposed over loopback TCP with `pglite-socket`, consumed by the production `PgDatabase` pool as the restricted `aura_app` role. No shared server, no fixture standing in for the database.
- `tests/tenant-isolation.test.ts`: RLS, cross-org denial, forged and missing identity, membership revocation, pooled identity isolation, invitation policy and escalation attempts against the real engine.
- `tests/migrations.test.ts`: applies `0001`–`0004` twice to prove replay safety, then asserts RLS coverage, policy names, the runtime role's attributes and ownership, per-table grants, function security (`SECURITY DEFINER`, pinned `search_path`, no `PUBLIC` execute) and absence of public-schema exposure.
- `tests/auth-api.test.ts`, `tests/workspace.test.ts`: HTTP contracts, CSRF, origin, cookie flags, lockout, session expiry, the registration ceiling, invitations, roles, revocation and platform administration.
- `tests/supabase-identity.test.ts`: token verification against a test-owned loopback issuer (JSON/HTML/401/slow/oversized/short tokens) and the unconfigured `501` path.
- `tests/config.test.ts`: offline and production configuration, fail-closed matrix, no secret echo, diagnostic token refused in production.
- `tests/email.test.ts`: all seven templates, HTML and plain text, local delivery via a test-owned `smtp-server` sink, invalid recipient, failed delivery, retry/backoff, idempotency, duplicate prevention, rate limits, redacted logs, no credential literals in source.
- Browser launch is shared through `tests/support/browser.ts`: it tries the portable flag set, then the flags a namespaced container needs, then Playwright's defaults, verifying that each candidate can render a page before use. `CHROMIUM_PATH` is optional — without it the bundled `@sparticuz/chromium` binary is used — and a launch failure is reported as a GitHub annotation instead of only in the log.

`tests/browser-auth.mjs`: registration, verification, login, session restoration, protected route redirect, logout plus cookie replay, password recovery and reused-link refusal in real Chromium against the built SPA, with external requests blocked and page errors asserted empty.

Limits of this evidence, stated once: PGlite is a single-process PostgreSQL build, so it proves SQL/RLS/policy behaviour and per-transaction identity, not multi-backend contention; deployed grants, PostgREST exposure, TLS mail delivery and deliverability still require the owner's isolated environment.

Future gates: real isolated Supabase integration and metadata/grant comparison; positive/negative verified identity and seller ownership when implemented; backup/restore rehearsal; concurrency and idempotency tests before inventory/payment; independent a11y/browser review. A registry audit with no findings does not replace threat review or target-side evidence.

## Phase 3 additions (seller and catalogue)

`corepack pnpm test` now runs 18 files / 290 tests (baseline 220). Every database
assertion runs on **PostgreSQL 18.6 via PGlite 0.5.16 (wasm32)** exposed over the
wire protocol as the restricted `aura_app` role — not a deployed PostgreSQL
instance. The Phase 3 layers, in order of strength:

- `tests/migrations.test.ts`: applies `0001`–`0006` twice, then asserts the six
  migration filenames, RLS on all nine new tables, the exact Phase 3 policy
  names, per-table grants (no product/revision/audit `DELETE`, read-only
  categories), `SECURITY DEFINER` plus pinned `search_path` and no `PUBLIC`
  execute on `is_platform_admin` and `build_product_snapshot`.
- `tests/marketplace-rls.test.ts` (32 tests): real engine, restricted `aura_app`
  role. Cross-tenant reads/writes, child rows under a foreign product, forged
  tenant settings, role matrices, completeness checks, revision freezing,
  approval/rejection, archive, audit immutability, seller-authored review
  metadata rejection, storefront projection visibility, approved-seller filtering
  and child-content lifecycle (approved content changes withdraw purchasability;
  submitted/archived products refuse child changes).
- `tests/marketplace-api.test.ts` (16 tests): loopback HTTP against the real
  Express app. Session and CSRF requirements, organization switch, onboarding,
  approval, draft creation, completeness errors, variant/media/attribute
  validation, submit/approve/edit/re-archive lifecycle, rejection note
  requirement, non-admin denial, payload cap, cross-site origin rejection and the
  platform grant's inability to act as organization membership.
- `tests/marketplace-ui.test.tsx` (10 tests, jsdom): renders the actual pages
  with a mocked transport. Onboarding and submission, read-only submitted
  product, submit POST, product list plus draft creation and redirect, viewer
  role without write controls, and the admin queue gated on the server-reported
  platform flag. Asserts that
  `x-aura-org` is the only tenant input sent.
- `tests/browser-seller.mjs` (CI-only in this environment): two real Chromium
  contexts drive seller onboarding, platform approval, catalogue creation,
  submission, snapshot review, approval, post-approval edit and storefront
  regression. **It does not run in the audit sandbox** — Chromium cannot start
  because `libnspr4.so`, `libnss3.so` and `libnssutil3.so` are absent — so browser
  coverage is reported as failed/blocked, never as passed. It runs in CI on a PR.
- `tests/routing.test.ts` extends the document-path allowlist with `/seller`,
  `/seller/products`, `/seller/products/<uuid>` and `/admin/review`.

Limits: jsdom is not a layout or keyboard-navigation test; the browser suite is
single-browser smoke coverage and is currently blocked locally; PGlite 18.6 is
single-process, so locking and pool behaviour under real concurrency are
unproven; and none of these suites exercise a deployed Supabase project, a CDN, a
real image host or concurrent sellers editing the same product.
