/**
 * Phase 4 browser verification of the public marketplace discovery surface and
 * the admin suspension controls, in a real Chromium against the compiled SPA
 * served by the real Express app + disposable PostgreSQL.
 *
 * This is NEW Phase 4 evidence; it does not modify the preserved baseline
 * browser suites (browser.mjs / browser-auth.mjs / browser-seller.mjs).
 * Run: node --import tsx --test tests/browser-marketplace.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { launchChromium, chromiumExecutable } from "./support/browser.ts";
import { startTestApp } from "./support/app.ts";
import { findMessage, tokenFromMessage } from "./support/smtp.ts";

const password = "browser-password-1";

test("public discovery, detail redirect and admin suspension round-trip", async t => {
  const executablePath = await chromiumExecutable();
  const app = await startTestApp({
    staticPath: resolve("dist/public"),
    config: { PUBLIC_READ_IP_LIMIT: "100000" },
  });
  t.after(async () => {
    await app.close();
  });
  const origin = app.baseUrl;

  // ---- Seed a verified operator and an approved seller with two products ----
  const verifiedUser = async email => {
    const client = app.client();
    const registration = await client.post("/api/v1/auth/register", {
      email,
      password,
      displayName: "Seed User",
    });
    assert.equal(registration.status, 201);
    const token = tokenFromMessage(
      findMessage(app.sink, { to: email, subject: "Confirm your AURA email" }),
      "/verify-email"
    );
    const verification = await client.post("/api/v1/auth/email/verify", { token });
    assert.equal(verification.status, 200);
    return {
      client,
      organizationId: registration.body.organizations[0].id,
      principalId: registration.body.principal.id,
    };
  };

  const operator = await verifiedUser("p4.browser.operator@example.test");
  await app.db.admin.query(
    `insert into aura.platform_admins (principal_id, note) values ($1, 'browser marketplace')`,
    [operator.principalId]
  );
  const seller = await verifiedUser("p4.browser.seller@example.test");
  const orgHeader = { headers: { "x-aura-org": seller.organizationId } };

  const saved = await seller.client.put(
    "/api/v1/seller/profile",
    {
      displayName: "Browser Atelier",
      legalName: "Browser Atelier Private Limited",
      businessEmail: "studio@browser.test",
      country: "IN",
    },
    orgHeader
  );
  assert.ok(saved.status < 300);
  assert.equal(
    (await seller.client.post("/api/v1/seller/profile/submit", {}, orgHeader)).status,
    200
  );
  assert.equal(
    (await operator.client.post(`/api/v1/admin/sellers/${seller.organizationId}/approve`, {})).status,
    200
  );

  const categories = (
    await seller.client.get("/api/v1/categories", orgHeader)
  ).body.categories;
  const publish = async ({ title, slug, categorySlug, attrKey, attrValue, sku }) => {
    const category = categories.find(c => c.slug === categorySlug);
    const required = category.attributes.find(a => a.key === attrKey);
    const created = await seller.client.post(
      "/api/v1/seller/products",
      { title, slug, categoryId: category.id, summary: `${title} summary.` },
      orgHeader
    );
    assert.equal(created.status, 201);
    const id = created.body.product.id;
    assert.equal(
      (await seller.client.post(`/api/v1/seller/products/${id}/variants`, { sku, title: "Default", size: "42", colour: "black" }, orgHeader)).status,
      201
    );
    assert.equal(
      (await seller.client.put(`/api/v1/seller/products/${id}/attributes`, { values: [{ attributeId: required.id, value: attrValue }] }, orgHeader)).status,
      200
    );
    assert.equal(
      (await seller.client.post(`/api/v1/seller/products/${id}/media`, { url: `https://cdn.browser.test/${slug}.png`, altText: "Hero" }, orgHeader)).status,
      201
    );
    assert.equal(
      (await seller.client.post(`/api/v1/seller/products/${id}/submit`, {}, orgHeader)).status,
      201
    );
    assert.equal(
      (await operator.client.post(`/api/v1/admin/products/${id}/approve`, { note: "ok" })).status,
      200
    );
    return id;
  };
  await publish({ title: "Aurora Runner", slug: "aurora-runner", categorySlug: "sneakers", attrKey: "upper-material", attrValue: "knit", sku: "BR-AURORA-42" });
  await publish({ title: "Zephyr Tee", slug: "zephyr-tee", categorySlug: "apparel", attrKey: "fabric", attrValue: "organic-cotton", sku: "BR-ZEPHYR-M" });

  // ---- Browser contexts ----
  const browser = await launchChromium(executablePath);
  t.after(async () => {
    await browser.close();
  });
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.route("**/*", route =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    return { context, page, errors };
  };

  const anon = await open();
  const reviewer = await open();

  // Retry until the grid reaches the EXPECTED state. After an in-page filter
  // change the previous grid is still mounted, so a bare waitFor() can resolve
  // against stale content (or catch the loading unmount and read 0 cards).
  // waitForFunction re-evaluates until count + content match the new query.
  const gridState = (page, { count, includes, firstIncludes }) =>
    page.waitForFunction(
      ({ count, includes, firstIncludes }) => {
        const grid = document.querySelector('[data-testid="marketplace-grid"]');
        if (!grid) return false;
        const cards = [...grid.querySelectorAll('[data-testid="marketplace-card"]')];
        if (cards.length !== count) return false;
        if (includes && !new RegExp(includes).test(grid.textContent ?? "")) return false;
        if (firstIncludes && !new RegExp(firstIncludes).test(cards[0]?.textContent ?? ""))
          return false;
        return true;
      },
      { count, includes: includes ?? null, firstIncludes: firstIncludes ?? null },
      { timeout: 15_000 }
    );

  // 1. Anonymous discovery renders the published catalogue.
  await anon.page.goto(`${origin}/marketplace`);
  await anon.page.getByTestId("marketplace-grid").waitFor();
  assert.equal(await anon.page.getByTestId("marketplace-card").count(), 2);
  assert.match(await anon.page.getByTestId("marketplace-grid").innerText(), /Aurora Runner/);
  assert.match(await anon.page.getByTestId("marketplace-grid").innerText(), /Zephyr Tee/);

  // 2. Word search narrows the list (D-23).
  await anon.page.getByTestId("marketplace-search").fill("runner");
  await anon.page.getByRole("button", { name: "Search" }).click();
  await gridState(anon.page, { count: 1, includes: "Aurora Runner" });

  // 3. Category filter (D-25) and title sort (D-24).
  await anon.page.getByTestId("marketplace-search").fill("");
  await anon.page.getByRole("button", { name: "Search" }).click();
  await gridState(anon.page, { count: 2, includes: "Zephyr Tee" });
  await anon.page.getByTestId("marketplace-category").selectOption("apparel");
  await gridState(anon.page, { count: 1, includes: "Zephyr Tee" });
  await anon.page.getByTestId("marketplace-category").selectOption("");
  await anon.page.getByTestId("marketplace-sort").selectOption("title");
  // Newest order is [Zephyr, Aurora]; title A–Z must flip the first card to
  // Aurora, so this predicate cannot pass against the stale grid.
  await gridState(anon.page, { count: 2, firstIncludes: "Aurora Runner" });

  // 4. Detail page renders the allowlisted content.
  await anon.page.goto(`${origin}/marketplace/product/aurora-runner`);
  await anon.page.getByTestId("marketplace-detail").waitFor();
  assert.match(await anon.page.getByTestId("marketplace-detail").innerText(), /Aurora Runner/);
  await anon.page.getByTestId("marketplace-attributes").waitFor();
  assert.match(await anon.page.getByTestId("marketplace-attributes").innerText(), /knit/);

  // 5. A legacy slug redirects to the canonical URL (live-first).
  const [live] = await app.db.admin.query(
    `select id, org_id, slug from aura.products where slug = 'aurora-runner'`
  );
  await app.db.admin.query(
    `insert into aura.slug_redirects (org_id, product_id, slug, replacement_slug, reason)
     values ($1, $2, 'aurora-runner-legacy', $3, 'global_collision')`,
    [live.org_id, live.id, live.slug]
  );
  await anon.page.goto(`${origin}/marketplace/product/aurora-runner-legacy`);
  await anon.page.getByTestId("marketplace-detail").waitFor();
  await anon.page.waitForURL(`${origin}/marketplace/product/aurora-runner`);

  // 6. Register the reviewer in the browser and grant the platform role.
  await reviewer.page.goto(`${origin}/register`);
  await reviewer.page.locator("#displayName").fill("Browser Reviewer");
  await reviewer.page.locator("#email").fill("p4.browser.reviewer@example.test");
  await reviewer.page.locator("#password").fill(password);
  await reviewer.page.getByRole("button", { name: "Create account" }).click();
  await reviewer.page.waitForURL(`${origin}/workspace`);
  const reviewerToken = tokenFromMessage(
    findMessage(app.sink, { to: "p4.browser.reviewer@example.test", subject: "Confirm your AURA email" }),
    "/verify-email"
  );
  await reviewer.page.goto(`${origin}/verify-email?token=${reviewerToken}`);
  await reviewer.page.getByText("Your email address is verified.").waitFor();
  const [reviewerPrincipal] = await app.db.admin.query(
    `select id from aura.principals where email = $1`,
    ["p4.browser.reviewer@example.test"]
  );
  await app.db.admin.query(
    `insert into aura.platform_admins (principal_id, note) values ($1, 'browser marketplace')`,
    [reviewerPrincipal.id]
  );

  // 7. The Suspension tab suspends the seller with a confidential note.
  await reviewer.page.goto(`${origin}/admin/review`);
  await reviewer.page.getByRole("tab", { name: /Suspension/ }).click();
  await reviewer.page.getByTestId("suspension-queue").waitFor();
  await reviewer.page.getByTestId(`suspension-input-${seller.organizationId}`).fill("Repeated policy violations.");
  await reviewer.page.getByTestId(`suspend-${seller.organizationId}`).click();
  await reviewer.page.getByText(/was suspended/).waitFor();
  // The confidential note only renders once the reloaded list reports the
  // suspension, so it is the barrier that the re-render has completed.
  await reviewer.page.getByTestId(`suspension-note-${seller.organizationId}`).waitFor();
  assert.match(
    await reviewer.page.getByTestId(`suspension-state-${seller.organizationId}`).innerText(),
    /Suspended/
  );
  assert.match(
    await reviewer.page.getByTestId(`suspension-note-${seller.organizationId}`).innerText(),
    /Repeated policy violations/i
  );

  // 8. The suspended seller's products vanish from the anonymous catalogue.
  await anon.page.goto(`${origin}/marketplace`);
  await anon.page.getByTestId("marketplace-empty").waitFor();
  assert.equal(await anon.page.getByTestId("marketplace-card").count(), 0);
  // The SPA document loads (200); the client renders the uniform not-found
  // state because the public detail API returns 404 for the suspended product.
  await anon.page.goto(`${origin}/marketplace/product/aurora-runner`);
  await anon.page.getByText("Product not found.").waitFor();

  // 9. Restore re-publishes the products.
  await reviewer.page.getByTestId(`restore-${seller.organizationId}`).click();
  await reviewer.page.getByText(/was restored/).waitFor();
  await anon.page.goto(`${origin}/marketplace`);
  await anon.page.getByTestId("marketplace-grid").waitFor();
  assert.equal(await anon.page.getByTestId("marketplace-card").count(), 2);

  // 10. The HOLO preview storefront is unchanged.
  await anon.page.goto(`${origin}/catalog`);
  await anon.page.locator('a[href^="/products/"]').first().waitFor({ state: "attached" });

  assert.deepEqual(anon.errors, []);
  assert.deepEqual(reviewer.errors, []);
});
