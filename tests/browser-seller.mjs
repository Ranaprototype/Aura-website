/**
 * Browser verification of Phase 3 in a real Chromium.
 *
 * Two independent browser contexts drive the seller and the platform reviewer
 * through the actual application: onboarding, approval, catalogue creation,
 * submission, review and the effect of a post-approval edit. The compiled SPA
 * is served by the real Express app, backed by the disposable PostgreSQL
 * instance and the loopback SMTP sink; no external request is permitted.
 *
 * Requires a Chromium executable: set CHROMIUM_PATH, or rely on
 * `@sparticuz/chromium`. The suite fails loudly rather than skipping.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { launchChromium, chromiumExecutable } from "./support/browser.ts";
import { startTestApp } from "./support/app.ts";
import { findMessage, tokenFromMessage } from "./support/smtp.ts";

const password = "browser-password-1";

test("seller onboarding, catalogue submission and platform approval", async t => {
  const executablePath = await chromiumExecutable();
  const app = await startTestApp({ staticPath: resolve("dist/public") });
  t.after(async () => {
    await app.close();
  });
  const origin = app.baseUrl;

  const browser = await launchChromium(executablePath);
  t.after(async () => {
    await browser.close();
  });

  const open = async () => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    await context.route("**/*", route =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort()
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    return { context, page, errors };
  };

  const register = async (page, { email, name }) => {
    await page.goto(`${origin}/register`);
    await page.locator("#displayName").fill(name);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(`${origin}/workspace`);
    const token = tokenFromMessage(
      findMessage(app.sink, { to: email, subject: "Confirm your AURA email" }),
      "/verify-email"
    );
    assert.ok(token, "the verification email must contain a token");
    await page.goto(`${origin}/verify-email?token=${token}`);
    await page.getByText("Your email address is verified.").waitFor();
  };

  const seller = await open();
  const reviewer = await open();

  // 1. The seller surface is protected before sign-in.
  await seller.page.goto(`${origin}/seller`);
  await seller.page.waitForURL(`${origin}/sign-in`);

  // 2. Register and verify the seller, then complete onboarding.
  const sellerEmail = "phase3.seller@example.test";
  await register(seller.page, {
    email: sellerEmail,
    name: "Phase Three Seller",
  });
  await seller.page.goto(`${origin}/seller`);
  await seller.page.getByRole("heading", { name: "Seller studio" }).waitFor();
  await seller.page.locator("#displayName").fill("Browser Atelier");
  await seller.page
    .locator("#legalName")
    .fill("Browser Atelier Private Limited");
  await seller.page.locator("#businessEmail").fill("studio@browser.test");
  await seller.page.locator("#country").fill("IN");
  await seller.page.locator("#website").fill("https://browser.test");
  await seller.page
    .getByRole("button", { name: "Create seller profile" })
    .click();
  await seller.page
    .getByText(
      "Saved. Submit the profile for platform review when it is complete."
    )
    .waitFor();
  await seller.page.getByTestId("seller-submit").click();
  await seller.page.getByText(/awaiting platform review/).waitFor();
  await seller.page
    .getByTestId("seller-status")
    .getByText("submitted", { exact: true })
    .waitFor();

  // 3. Register the reviewer and grant the platform role out of band, exactly
  //    as an operator would. No browser input can grant it.
  const reviewerEmail = "phase3.reviewer@example.test";
  await register(reviewer.page, {
    email: reviewerEmail,
    name: "Phase Three Reviewer",
  });
  const [principal] = await app.db.admin.query(
    `select id from aura.principals where email = $1`,
    [reviewerEmail]
  );
  assert.ok(principal, "the reviewer principal must exist");
  await app.db.admin.query(
    `insert into aura.platform_admins (principal_id, note) values ($1, 'browser suite')`,
    [principal.id]
  );

  // 4. The reviewer approves the seller application through the review queue.
  await reviewer.page.goto(`${origin}/admin/review`);
  await reviewer.page.getByTestId("seller-queue").waitFor();
  assert.ok(
    (
      await reviewer.page.getByTestId("seller-queue-count").innerText()
    ).includes("1")
  );
  await reviewer.page.getByRole("button", { name: "Approve seller" }).click();
  await reviewer.page.getByText(/is now an approved seller/).waitFor();

  // 5. The seller dashboard now reports approval.
  await seller.page.reload();
  await seller.page
    .getByTestId("seller-status")
    .getByText("approved", { exact: true })
    .waitFor();

  // 6. Create a draft and complete its catalogue data.
  await seller.page.goto(`${origin}/seller/products`);
  await seller.page.locator("#product-title").fill("Browser Runner");
  await seller.page.getByTestId("create-product").click();
  await seller.page.waitForURL(/\/seller\/products\/[0-9a-f-]{36}$/);
  await seller.page
    .getByTestId("product-status")
    .getByText("draft", { exact: true })
    .waitFor();

  await seller.page.locator("#variant-sku").fill("BROWSER-RUNNER-42");
  await seller.page.locator("#variant-title").fill("Size 42 / Cyan");
  await seller.page.locator("#variant-size").fill("42");
  await seller.page.locator("#variant-colour").fill("cyan");
  await seller.page.getByRole("button", { name: "Add variant" }).click();
  await seller.page
    .getByTestId("variant-count")
    .getByText("1", { exact: true })
    .waitFor();

  await seller.page.locator("#attribute-upper-material").selectOption("knit");
  await seller.page.getByRole("button", { name: "Save attributes" }).click();
  await seller.page.getByText("Category attributes saved.").waitFor();

  await seller.page
    .locator("#media-url")
    .fill("https://cdn.browser.test/runner.png");
  await seller.page.locator("#media-alt").fill("Front view");
  await seller.page.getByRole("button", { name: "Add media" }).click();
  await seller.page
    .getByTestId("media-count")
    .getByText("1", { exact: true })
    .waitFor();

  // 7. Submission freezes the working copy.
  await seller.page.getByTestId("submit-product").click();
  await seller.page
    .getByTestId("product-status")
    .getByText("submitted", { exact: true })
    .waitFor();
  assert.equal(
    await seller.page.locator("#edit-title").isDisabled(),
    true,
    "a submitted product must not be editable"
  );

  // 8. The reviewer reads the submitted snapshot and approves it.
  await reviewer.page.goto(`${origin}/admin/review`);
  await reviewer.page.getByRole("tab", { name: /Products/ }).click();
  await reviewer.page.getByTestId("product-queue").waitFor();
  await reviewer.page
    .getByRole("button", { name: "Review submitted copy" })
    .click();
  const snapshot = await reviewer.page
    .getByTestId("revision-snapshot")
    .innerText();
  assert.match(snapshot, /BROWSER-RUNNER-42/);
  await reviewer.page
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await reviewer.page.getByText(/is approved/).waitFor();

  // 9. Only now is the product in the purchasable projection, and it leaves
  //    that projection as soon as approved content is edited.
  await seller.page.reload();
  await seller.page
    .getByTestId("product-status")
    .getByText("approved", { exact: true })
    .waitFor();
  assert.equal(await seller.page.getByTestId("purchasable").innerText(), "yes");
  await seller.page
    .getByTestId("audit-list")
    .getByText("product.approved", { exact: true })
    .waitFor();

  await seller.page.locator("#edit-description").fill("Edited after approval.");
  await seller.page.getByRole("button", { name: "Save working copy" }).click();
  await seller.page.getByText("Working copy saved.").waitFor();
  assert.equal(await seller.page.getByTestId("purchasable").innerText(), "no");

  // 10. The HOLO storefront is unchanged.
  await seller.page.goto(`${origin}/`);
  await seller.page
    .getByText("Newsletter enrollment is unavailable.")
    .waitFor({ state: "attached" });
  await seller.page.goto(`${origin}/catalog`);
  await seller.page
    .locator('a[href^="/products/"]')
    .first()
    .waitFor({ state: "attached" });

  assert.deepEqual(seller.errors, []);
  assert.deepEqual(reviewer.errors, []);
});
