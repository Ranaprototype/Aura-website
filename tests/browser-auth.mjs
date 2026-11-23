/**
 * Browser verification of the authentication experience in a real Chromium.
 *
 * The compiled SPA is served by the real Express application, backed by the
 * disposable PostgreSQL instance and the loopback SMTP sink. Covers the HOLO
 * storefront regression, registration, email verification, session restoration,
 * logout, protected routes and password recovery.
 *
 * Requires a Chromium executable: set CHROMIUM_PATH, or install
 * `@sparticuz/chromium` (present as a dev dependency).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { startTestApp, APP_ORIGIN } from "./support/app.ts";
import { findMessage, tokenFromMessage } from "./support/smtp.ts";

const executablePath = async () => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const module = await import("@sparticuz/chromium");
  return module.default.executablePath();
};

test("authentication, verification, recovery, protected routes and storefront", async t => {
  const path = await executablePath();
  assert.ok(path, "A Chromium executable is required; set CHROMIUM_PATH.");

  const app = await startTestApp({ staticPath: resolve("dist/public") });
  t.after(async () => {
    await app.close();
  });
  const origin = app.baseUrl;

  const browser = await chromium.launch({
    executablePath: path,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--no-zygote",
      "--single-process",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
  t.after(async () => {
    await browser.close();
  });

  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    reducedMotion: "reduce",
  });
  // No external request may leave the sandbox during the run.
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  const email = "browser.user@example.test";
  const password = "browser-password-1";
  const newPassword = "browser-password-2";

  // 1. The existing HOLO storefront is unchanged and still renders.
  await page.goto(`${origin}/`);
  await page.getByText("Newsletter enrollment is unavailable.").waitFor({ state: "attached" });
  assert.equal(await page.locator("#newsletter input, #newsletter form").count(), 0);
  await page.goto(`${origin}/catalog`);
  await page.locator('a[href^="/products/"]').first().waitFor({ state: "attached" });
  assert.ok((await page.locator("body").innerText()).length > 100);

  // 2. Protected route: a signed-out visitor cannot see the workspace.
  await page.goto(`${origin}/workspace`);
  await page.waitForURL(`${origin}/sign-in`);
  await page.getByRole("heading", { name: "Sign in" }).waitFor();

  // Server-side too: no session cookie, no data.
  assert.equal((await context.request.get(`${origin}/api/v1/projects`)).status(), 401);

  // 3. Registration.
  await page.goto(`${origin}/register`);
  await page.locator("#displayName").fill("Browser User");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(`${origin}/workspace`);
  await page.getByTestId("workspace-heading").waitFor();
  assert.equal(await page.getByTestId("signed-in-email").innerText(), email);
  await page.getByText("Confirm your email address to unlock protected actions.").waitFor();

  // Unverified accounts cannot use protected actions: the browser holds a valid
  // session but the server still refuses the write.
  const session = await page.evaluate(() =>
    fetch("/api/v1/auth/session", { credentials: "same-origin" }).then(response => response.json())
  );
  const organizationId = session.organizations?.[0]?.id;
  assert.ok(organizationId);
  const csrf = (await context.cookies()).find(cookie => cookie.name === "aura_csrf")?.value;
  assert.ok(csrf);
  const unverified = await context.request.post(`${origin}/api/v1/projects`, {
    data: { name: "Too early" },
    headers: { "x-csrf-token": csrf, "x-aura-org": organizationId },
  });
  assert.equal(unverified.status(), 403);

  // 4. Email verification through the delivered link.
  const verificationMessage = findMessage(app.sink, {
    to: email,
    subject: "Confirm your AURA email",
  });
  const verifyToken = tokenFromMessage(verificationMessage, "/verify-email");
  assert.ok(verifyToken, "the verification email must contain a token");
  await page.goto(`${origin}/verify-email?token=${verifyToken}`);
  await page.getByText("Your email address is verified.").waitFor();

  // 5. Session restoration and protected work after verification.
  await page.goto(`${origin}/workspace`);
  await page.getByText("Email verified.").waitFor();
  const reloadedEmail = await page.getByTestId("signed-in-email").innerText();
  assert.equal(reloadedEmail, email);
  await page.locator("#project-name").fill("Browser project");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByText("Browser project").waitFor();
  await page.reload();
  await page.getByTestId("workspace-heading").waitFor();
  await page.getByText("Browser project").waitFor();

  // 6. Logout revokes the session and the cookie cannot be replayed.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${origin}/sign-in`);
  assert.equal((await context.request.get(`${origin}/api/v1/auth/session`)).status(), 200);
  const afterLogout = await (await context.request.get(`${origin}/api/v1/auth/session`)).json();
  assert.equal(afterLogout.authenticated, false);
  await page.goto(`${origin}/workspace`);
  await page.waitForURL(`${origin}/sign-in`);

  // 7. Login rejects a wrong password and accepts the right one.
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("definitely-wrong-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("That email and password combination was not accepted.").waitFor();
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${origin}/workspace`);
  await page.getByTestId("workspace-heading").waitFor();

  // 8. Sign out, then recover the password through the emailed link.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${origin}/sign-in`);
  await page.goto(`${origin}/forgot-password`);
  await page.locator("#email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByText("If an account exists for that address").waitFor();

  const resetMessage = findMessage(app.sink, { to: email, subject: "Reset your AURA" });
  const resetToken = tokenFromMessage(resetMessage, "/reset-password");
  assert.ok(resetToken, "the reset email must contain a single-use token");
  await page.goto(`${origin}/reset-password?token=${resetToken}`);
  await page.locator("#password").fill(newPassword);
  await page.locator("#confirm").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.getByText("Password updated.").waitFor();

  // 9. The old password no longer works; the new one does.
  await page.goto(`${origin}/sign-in`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("That email and password combination was not accepted.").waitFor();
  await page.locator("#password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${origin}/workspace`);
  await page.getByTestId("workspace-heading").waitFor();
  await page.getByText("Browser project").waitFor();

  // 10. A replayed reset link is refused.
  await page.goto(`${origin}/reset-password?token=${resetToken}`);
  await page.locator("#password").fill("browser-password-3");
  await page.locator("#confirm").fill("browser-password-3");
  await page.getByRole("button", { name: "Update password" }).click();
  await page.getByText("That link is invalid, already used or expired.").waitFor();

  assert.deepEqual(pageErrors, []);
  assert.ok(APP_ORIGIN.length > 0);
});
