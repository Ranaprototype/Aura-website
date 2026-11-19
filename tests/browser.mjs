import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { once } from "node:events";
import { chromium } from "playwright-core";
import { createApp } from "../server/app.ts";

// Serve the real compiled client, with no configured database or diagnostics token.
// Explicit executable, fresh profile, no persistent context, no external requests.
test("catalog → configured object → local cart → unavailable checkout; direct links cannot confer identity or an order", async t => {
  assert.ok(
    process.env.CHROMIUM_PATH,
    "Set CHROMIUM_PATH to a local Chromium executable; build first."
  );
  const server = createApp({ staticPath: resolve("dist/public") }).listen(
    0,
    "127.0.0.1"
  );
  t.after(() => new Promise(done => server.close(done)));
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await context.route("**/*", route =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort()
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.goto(origin + "/");
    await page
      .getByText("Newsletter enrollment is unavailable.")
      .waitFor({ state: "attached" });
    assert.equal(
      await page.locator("#newsletter input, #newsletter form").count(),
      0
    );
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /secure checkout|30-day returns|free shipping|access granted/i
    );
    await page.goto(origin + "/product/sneaker");
    await page
      .getByText("Design preview · Not available for purchase")
      .waitFor({ state: "attached" });
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /ships worldwide|ships in|30-day returns/i
    );
    await page.goto(origin + "/catalog");
    await page.locator('a[href^="/products/"]').first().click();
    await page.getByRole("button", { name: "Add to Collection" }).click();
    await page.goto(origin + "/cart");
    await page
      .getByRole("link", { name: "Checkout information" })
      .first()
      .click();
    await page
      .getByRole("heading", { name: "Checkout is unavailable." })
      .waitFor();
    assert.equal(await page.locator("input,form,iframe").count(), 0);
    for (const [path, heading] of [
      ["/order/synthetic", "Order verification unavailable."],
      ["/account/orders/synthetic", "Accounts are unavailable."],
      ["/missing-page", "Page not found."],
    ]) {
      await page.goto(origin + path);
      await page.getByRole("heading", { name: heading }).waitFor();
      assert.equal(await page.locator("input,form,iframe").count(), 0);
    }
    await page.goto(origin + "/test-supabase");
    await page.getByText("Database unavailable.").waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
