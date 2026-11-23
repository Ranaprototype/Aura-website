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
- `tests/browser-auth.mjs`: registration, verification, login, session restoration, protected route redirect, logout plus cookie replay, password recovery and reused-link refusal in real Chromium against the built SPA, with external requests blocked and page errors asserted empty.

Limits of this evidence, stated once: PGlite is a single-process PostgreSQL build, so it proves SQL/RLS/policy behaviour and per-transaction identity, not multi-backend contention; deployed grants, PostgREST exposure, TLS mail delivery and deliverability still require the owner's isolated environment.

Future gates: real isolated Supabase integration and metadata/grant comparison; positive/negative verified identity and seller ownership when implemented; backup/restore rehearsal; concurrency and idempotency tests before inventory/payment; independent a11y/browser review. A registry audit with no findings does not replace threat review or target-side evidence.
