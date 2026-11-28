/**
 * Phase 4 planning validation — app-level probes on the REAL Express app with
 * a disposable PGlite database (same harness as the repository test suites).
 * Proves the current middleware behaviour the Phase 4 plan must preserve or
 * correct. Run: node --import tsx validation/phase-4/probe-app.ts
 */
import { startTestApp } from "../../tests/support/app";

let passed = 0;
let failed = 0;
const ok = (name: string, condition: boolean, detail = "") => {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

async function main() {
  const app = await startTestApp();
  try {
    const live = await fetch(`${app.baseUrl}/api/health/live`);
    ok("A.1 /api/health/live carries Cache-Control: no-store",
      live.headers.get("cache-control") === "no-store",
      `got: ${live.headers.get("cache-control")}`);

    const session = await fetch(`${app.baseUrl}/api/v1/auth/session`);
    const sessionCc = session.headers.get("cache-control");
    ok("A.2 anonymous GET /api/v1/auth/session succeeds without any cookie (CSRF-safe GET path)",
      session.status === 200, `status=${session.status}`);
    // Documents the CURRENT defect: the no-store middleware is mounted after
    // the v1 routers, so v1 responses never receive it. Phase 4 must move it.
    console.log(`INFO  /api/v1/auth/session Cache-Control = ${JSON.stringify(sessionCc)} (expected defect: null)`);
    ok("A.3 DEFECT CONFIRMED: v1 responses currently lack no-store (Phase 4 must fix mount order)",
      sessionCc === null, `got: ${sessionCc}`);

    const crossGet = await fetch(`${app.baseUrl}/api/v1/auth/session`, {
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    ok("A.4 anonymous public-style GET is not blocked by origin/CSRF guard (safe method)",
      crossGet.status === 200, `status=${crossGet.status}`);

    const crossPost = await fetch(`${app.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ email: "nobody@example.test", password: "x" }),
    });
    const crossBody = (await crossPost.json()) as { error?: string };
    ok("A.5 cross-site mutation still refused (origin_rejected)",
      crossPost.status === 403 && crossBody.error === "origin_rejected",
      `status=${crossPost.status} error=${crossBody.error}`);

    const missing = await fetch(`${app.baseUrl}/api/v1/storefront/products`);
    const missingBody = (await missing.json()) as { error?: string };
    ok("A.6 no public catalogue endpoint exists today; uniform JSON 404 not_found",
      missing.status === 404 && missingBody.error === "not_found",
      `status=${missing.status} error=${missingBody.error}`);
    ok("A.7 API 404 carries no-store (catch-all path)",
      missing.headers.get("cache-control") === "no-store");

    const seller = await fetch(`${app.baseUrl}/api/v1/seller/dashboard`);
    const sellerBody = (await seller.json()) as { error?: string };
    ok("A.8 seller surface requires a session (401 authentication_required)",
      seller.status === 401 && sellerBody.error === "authentication_required");

    const csrfCookie = session.headers.getSetCookie().some(c => c.startsWith("aura_csrf="));
    ok("A.9 csrfGuard issues the double-submit cookie on anonymous GET (public reads must tolerate it)",
      csrfCookie);
  } finally {
    await app.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch(error => {
  console.error("PROBE CRASH:", error);
  process.exit(1);
});
