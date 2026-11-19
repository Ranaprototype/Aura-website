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

Future gates: real isolated Supabase integration and metadata/grant comparison; positive/negative verified identity and seller ownership when implemented; backup/restore rehearsal; concurrency and idempotency tests before inventory/payment; independent a11y/browser review. A registry audit with no findings does not replace threat review or target-side evidence.
