/**
 * HTTP-level authentication verification against the real Express app, the real
 * PostgreSQL instance and a local SMTP sink: registration, login, logout,
 * session restoration, email verification, password recovery, CSRF, cookie
 * security, forged identity attempts and cross-tenant denial.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findMessage, tokenFromMessage } from "./support/smtp";
import { registerUser, startTestApp, type TestApp, type TestClient } from "./support/app";

let app: TestApp;

const password = "correct-horse-battery-9";

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

async function verifyEmail(client: TestClient, email: string) {
  const message = findMessage(app.sink, { to: email, subject: "Confirm your AURA email" });
  const token = tokenFromMessage(message, "/verify-email");
  expect(token).toBeTruthy();
  const result = await client.post("/api/v1/auth/email/verify", { token });
  expect(result.status).toBe(200);
  return token;
}

describe("registration", () => {
  it("creates an account, an owner organization and a server-side session", async () => {
    const client = app.client();
    const result = await client.post<{
      principal: { email: string; emailVerified: boolean };
      organizations: Array<{ role: string }>;
    }>("/api/v1/auth/register", {
      email: "fresh@example.test",
      password,
      displayName: "Fresh User",
    });
    expect(result.status).toBe(201);
    expect(result.body.principal).toMatchObject({
      email: "fresh@example.test",
      emailVerified: false,
    });
    expect(result.body.organizations).toHaveLength(1);
    expect(result.body.organizations[0]?.role).toBe("owner");

    const cookies = result.headers.getSetCookie();
    const session = cookies.find(cookie => cookie.startsWith("aura_session="));
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\//);
    const csrf = cookies.find(cookie => cookie.startsWith("aura_csrf="));
    expect(csrf).toBeDefined();
    expect(csrf).not.toMatch(/HttpOnly/);

    // The raw session token is never stored; only its digest is.
    const raw = client.cookie("aura_session") ?? "";
    const stored = await app.db.db.query<{ token_hash: Buffer }>(
      `select token_hash from aura.sessions`
    );
    const digest = Buffer.from(raw, "base64url");
    expect(digest.length).toBeGreaterThan(0);
    expect(stored.length).toBeGreaterThan(0);
    const hashHex = await app.db.db.query<{ hash: string }>(
      `select encode(token_hash,'hex') as hash from aura.sessions
        where token_hash = sha256($1::bytea)`,
      [raw]
    );
    expect(hashHex).toHaveLength(1);
  });

  it("delivers the welcome and verification emails through the local service", async () => {
    const welcome = findMessage(app.sink, { to: "fresh@example.test", subject: "Welcome to AURA" });
    const verification = findMessage(app.sink, {
      to: "fresh@example.test",
      subject: "Confirm your AURA email",
    });
    expect(welcome).toBeDefined();
    expect(verification).toBeDefined();
    expect(tokenFromMessage(verification, "/verify-email")).toBeTruthy();
    // No recovery token is ever written to a log entry.
    const serialized = JSON.stringify(app.logs);
    expect(serialized).not.toContain(tokenFromMessage(verification, "/verify-email"));
    expect(serialized).not.toContain("fresh@example.test");
  });

  it("refuses a duplicate address without disclosing the account state further", async () => {
    const client = app.client();
    const result = await client.post("/api/v1/auth/register", {
      email: "fresh@example.test",
      password,
    });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ error: "email_unavailable" });
  });

  it.each([
    ["short", "short-password"],
    ["no digits", "onlylettersandlonger"],
    ["control characters", "long-enough-password\u0000"],
  ])("rejects a %s password with a specific policy code", async (_label, value) => {
    const client = app.client();
    const result = await client.post("/api/v1/auth/register", {
      email: `policy-${Buffer.from(value).toString("hex").slice(0, 10)}@example.test`,
      password: value,
    });
    expect(result.status).toBe(400);
    expect(["password_too_short", "password_too_simple", "password_control_characters"]).toContain(
      (result.body as { error: string }).error
    );
  });

  it("rejects a malformed address and unknown body fields", async () => {
    const client = app.client();
    const invalidEmail = await client.post("/api/v1/auth/register", {
      email: "not-an-email",
      password,
    });
    expect(invalidEmail.status).toBe(400);
    const extra = await client.post("/api/v1/auth/register", {
      email: "extra@example.test",
      password,
      role: "owner",
      principalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(extra.status).toBe(400);
  });
});

describe("protected routes and email verification", () => {
  it("refuses protected work until the address is confirmed", async () => {
    const user = await registerUser(app, { email: "unverified@example.test" });
    const denied = await user.client.post(
      "/api/v1/projects",
      { name: "Should not exist" },
      { headers: { "x-aura-org": user.organizationId } }
    );
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "email_unverified" });

    const listed = await user.client.get("/api/v1/projects", {
      headers: { "x-aura-org": user.organizationId },
    });
    expect(listed.status).toBe(403);

    await verifyEmail(user.client, user.email);

    const created = await user.client.post<{ project: { id: string } }>(
      "/api/v1/projects",
      { name: "First project" },
      { headers: { "x-aura-org": user.organizationId } }
    );
    expect(created.status).toBe(201);

    const session = await user.client.get<{
      authenticated: boolean;
      principal: { emailVerified: boolean };
    }>("/api/v1/auth/session");
    expect(session.body.authenticated).toBe(true);
    expect(session.body.principal.emailVerified).toBe(true);
  });

  it("refuses a replayed verification token", async () => {
    const user = await registerUser(app, { email: "replay@example.test" });
    const message = findMessage(app.sink, { to: "replay@example.test", subject: "Confirm" });
    const token = tokenFromMessage(message, "/verify-email") ?? "";
    expect((await user.client.post("/api/v1/auth/email/verify", { token })).status).toBe(200);
    const replay = await user.client.post("/api/v1/auth/email/verify", { token });
    expect(replay.status).toBe(400);
    expect(replay.body).toEqual({ error: "token_invalid" });
  });

  it("issues a fresh link on resend and invalidates the previous one", async () => {
    const user = await registerUser(app, { email: "resend@example.test" });
    const firstToken = tokenFromMessage(
      findMessage(app.sink, { to: "resend@example.test", subject: "Confirm" }),
      "/verify-email"
    );
    const resent = await user.client.post("/api/v1/auth/email/resend", {});
    expect(resent.status).toBe(200);
    const messages = app.sink.messages.filter(
      message => message.to.includes("resend@example.test") && /Confirm/.test(message.subject ?? "")
    );
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const latest = tokenFromMessage(messages.at(-1), "/verify-email");
    expect(latest).toBeTruthy();
    expect(latest).not.toBe(firstToken);

    const stale = await user.client.post("/api/v1/auth/email/verify", { token: firstToken });
    expect(stale.status).toBe(400);
    expect((await user.client.post("/api/v1/auth/email/verify", { token: latest })).status).toBe(200);
  });

  it("requires an organization membership for organization-scoped routes", async () => {
    const user = await registerUser(app, { email: "noorg@example.test" });
    await verifyEmail(user.client, user.email);
    const withoutHeader = await user.client.get("/api/v1/projects");
    expect(withoutHeader.status).toBe(400);
    expect(withoutHeader.body).toEqual({ error: "organization_required" });
    const bogus = await user.client.get("/api/v1/projects", {
      headers: { "x-aura-org": "not-a-uuid" },
    });
    expect(bogus.status).toBe(400);
  });
});

describe("login, logout and session restoration", () => {
  it("authenticates with the stored credential and restores the session", async () => {
    const user = await registerUser(app, { email: "session@example.test" });
    await verifyEmail(user.client, user.email);

    const fresh = app.client();
    const wrong = await fresh.post("/api/v1/auth/login", {
      email: "session@example.test",
      password: "wrong-password-123",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: "invalid_credentials" });

    const unknown = await fresh.post("/api/v1/auth/login", {
      email: "nobody@example.test",
      password,
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual({ error: "invalid_credentials" });

    const login = await fresh.post<{ principal: { email: string } }>("/api/v1/auth/login", {
      email: "session@example.test",
      password,
    });
    expect(login.status).toBe(200);
    expect(login.body.principal.email).toBe("session@example.test");

    // A brand-new client reusing the same cookies restores the session.
    const restored = app.client();
    fresh.cookies.forEach((value, name) => restored.cookies.set(name, value));
    const session = await restored.get<{ authenticated: boolean }>("/api/v1/auth/session");
    expect(session.status).toBe(200);
    expect(session.body.authenticated).toBe(true);
  });

  it("revokes the session on logout and refuses the old cookie", async () => {
    const user = await registerUser(app, { email: "logout@example.test" });
    await verifyEmail(user.client, user.email);
    const captured = new Map(user.client.cookies);

    const logout = await user.client.post("/api/v1/auth/logout", {});
    expect(logout.status).toBe(200);
    expect(logout.headers.getSetCookie().some(cookie => /aura_session=;/.test(cookie))).toBe(true);

    const afterLogout = await user.client.get<{ authenticated: boolean }>("/api/v1/auth/session");
    expect(afterLogout.body.authenticated).toBe(false);

    const replay = app.client();
    captured.forEach((value, name) => replay.cookies.set(name, value));
    const denied = await replay.get("/api/v1/projects");
    expect(denied.status).toBe(401);
    expect(denied.body).toEqual({ error: "authentication_required" });
  });

  it("refuses an expired session without waiting for a token rotation", async () => {
    const user = await registerUser(app, { email: "expiry@example.test" });
    await verifyEmail(user.client, user.email);
    const before = await user.client.get("/api/v1/projects", {
      headers: { "x-aura-org": user.organizationId },
    });
    expect(before.status).toBe(200);

    await app.db.admin.query(
      `update aura.sessions
          set created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'`
    );
    const after = await user.client.get("/api/v1/projects", {
      headers: { "x-aura-org": user.organizationId },
    });
    expect(after.status).toBe(401);
    expect(after.body).toEqual({ error: "authentication_required" });
  });

  it("enforces the registration ceiling as a real control", async () => {
    const limited = await startTestApp({ config: { AUTH_REGISTER_HOURLY_LIMIT: "2" } });
    try {
      const statuses: number[] = [];
      for (let index = 0; index < 3; index += 1) {
        const result = await limited.client().post("/api/v1/auth/register", {
          email: `ceiling-${index}@example.test`,
          password,
        });
        statuses.push(result.status);
      }
      expect(statuses).toEqual([201, 201, 429]);
      expect(
        await limited.db.admin.query(
          `select id from aura.principals where email = 'ceiling-2@example.test'`
        )
      ).toEqual([]);
    } finally {
      await limited.close();
    }
  });

  it("locks an account after repeated failures without disclosing the reason", async () => {
    const user = await registerUser(app, { email: "lockout@example.test" });
    await verifyEmail(user.client, user.email);
    const attacker = app.client();
    let last;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      last = await attacker.post("/api/v1/auth/login", {
        email: "lockout@example.test",
        password: "wrong-password-123",
      });
    }
    expect(last?.status).toBe(401);
    const locked = await app.db.db.query<{ locked_until: Date | null }>(
      `select c.locked_until from aura.credentials c
        join aura.principals p on p.id = c.principal_id where p.email = $1`,
      ["lockout@example.test"]
    );
    expect(locked[0]?.locked_until).toBeTruthy();

    // Even the correct password is refused while the lock is active.
    const correct = await attacker.post("/api/v1/auth/login", {
      email: "lockout@example.test",
      password,
    });
    expect(correct.status).toBe(401);
  });
});

describe("CSRF, origins and cookie security", () => {
  it("rejects a state-changing request without the double-submit token", async () => {
    const user = await registerUser(app, { email: "csrf@example.test" });
    const result = await user.client.post(
      "/api/v1/auth/logout",
      {},
      { csrf: false }
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: "csrf_failed" });
  });

  it("rejects a mismatched token and a foreign origin", async () => {
    const user = await registerUser(app, { email: "csrf2@example.test" });
    const badToken = await user.client.post(
      "/api/v1/auth/logout",
      {},
      { headers: { "x-csrf-token": "a".repeat(43) }, csrf: false }
    );
    expect(badToken.status).toBe(403);

    const foreignOrigin = await user.client.post(
      "/api/v1/auth/logout",
      {},
      { headers: { origin: "https://evil.example.test" } }
    );
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.body).toEqual({ error: "origin_rejected" });

    const crossSite = await user.client.post(
      "/api/v1/auth/logout",
      {},
      { headers: { "sec-fetch-site": "cross-site" } }
    );
    expect(crossSite.status).toBe(403);

    const allowedOrigin = await user.client.post(
      "/api/v1/auth/logout",
      {},
      { headers: { origin: app.baseUrl } }
    );
    expect(allowedOrigin.status).toBe(200);
  });

  it("allows safe reads without a CSRF token", async () => {
    const client = app.client();
    const result = await client.get("/api/v1/auth/session");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ authenticated: false });
    expect(client.cookie("aura_csrf")).toBeTruthy();
  });

  it("marks cookies Secure when the deployment is production", async () => {
    const production = await startTestApp({
      config: {
        NODE_ENV: "production",
        APP_ORIGIN: "https://aura.example.test",
      },
    });
    try {
      const client = production.client();
      const result = await client.post("/api/v1/auth/register", {
        email: "production@example.test",
        password,
      });
      expect(result.status).toBe(201);
      const cookies = result.headers.getSetCookie().join("\n");
      expect(cookies).toMatch(/aura_session=[^;]+;.*HttpOnly/);
      expect(cookies).toMatch(/Secure/);
    } finally {
      await production.close();
    }
  });
});

describe("forged identity attempts", () => {
  it("ignores principal, role and organization hints from headers, body and query", async () => {
    const victim = await registerUser(app, { email: "victim@example.test" });
    await verifyEmail(victim.client, victim.email);
    const attacker = await registerUser(app, { email: "attacker@example.test" });
    await verifyEmail(attacker.client, attacker.email);
    await victim.client.post(
      "/api/v1/projects",
      { name: "Victim secret" },
      { headers: { "x-aura-org": victim.organizationId } }
    );

    // Unknown body fields are rejected outright (strict schema) rather than
    // being silently interpreted as identity.
    const smuggling = await attacker.client.post(
      "/api/v1/projects",
      {
        name: "Forged project",
        principalId: victim.principalId,
        createdBy: victim.principalId,
        role: "owner",
        org_id: victim.organizationId,
      },
      { headers: { "x-aura-org": attacker.organizationId } }
    );
    expect(smuggling.status).toBe(400);
    expect(smuggling.body).toEqual({ error: "invalid_request" });
    expect(
      await app.db.admin.query(`select id from aura.projects where name = 'Forged project'`)
    ).toEqual([]);

    const forged = await attacker.client.post<{ project: { id: string } }>(
      "/api/v1/projects",
      { name: "Forged project" },
      {
        headers: {
          "x-aura-org": attacker.organizationId,
          "x-aura-principal": victim.principalId,
          "x-aura-role": "owner",
          "x-aura-user-id": victim.principalId,
        },
      }
    );
    expect(forged.status).toBe(201);

    const rows = await app.db.admin.query<{ created_by: string; org_id: string }>(
      `select created_by, org_id from aura.projects where id = $1`,
      [forged.body.project.id]
    );
    expect(rows[0]?.created_by).toBe(attacker.principalId);
    expect(rows[0]?.org_id).toBe(attacker.organizationId);

    // A foreign organization header is refused, not silently substituted.
    const crossTenant = await attacker.client.get("/api/v1/projects", {
      headers: {
        "x-aura-org": victim.organizationId,
        "x-aura-principal": victim.principalId,
        "x-aura-role": "owner",
      },
    });
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body).toEqual({ error: "organization_forbidden" });

    const queryHints = await attacker.client.get(
      `/api/v1/projects?org=${victim.organizationId}&principalId=${victim.principalId}&role=owner`,
      { headers: { "x-aura-org": attacker.organizationId } }
    );
    expect(queryHints.status).toBe(200);
    const names = (queryHints.body as { projects: Array<{ name: string }> }).projects.map(
      project => project.name
    );
    expect(names).toContain("Forged project");
    expect(names).not.toContain("Victim secret");
  });

  it("cannot reach the versioned API with the diagnostic operator token", async () => {
    const client = app.client();
    const result = await client.get("/api/v1/projects", {
      headers: { authorization: "Bearer synthetic-diagnostic-token-value" },
    });
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "authentication_required" });
  });

  it("does not expose a test-mode authentication switch", async () => {
    const { createApp } = await import("../server/app");
    const bare = createApp({});
    const server = bare.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/auth/session`);
      expect(response.status).toBe(404);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    const fs = await import("node:fs/promises");
    for (const file of ["server/services.ts", "server/app.ts", "server/modules/auth.ts"]) {
      const source = await fs.readFile(file, "utf8");
      expect(source, file).not.toMatch(/TEST_AUTH|AUTH_TEST_MODE|SKIP_AUTH|BYPASS_AUTH/);
    }
  });
});

describe("password recovery", () => {
  it("answers identically for known and unknown addresses", async () => {
    const client = app.client();
    const known = await client.post("/api/v1/auth/password/forgot", {
      email: "session@example.test",
    });
    const unknown = await client.post("/api/v1/auth/password/forgot", {
      email: "unknown-address@example.test",
    });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(app.sink.messages.some(message => message.to.includes("unknown-address@example.test"))).toBe(
      false
    );
  });

  it("resets the password, revokes every session and invalidates the link", async () => {
    const user = await registerUser(app, { email: "recover@example.test" });
    await verifyEmail(user.client, user.email);
    const captured = new Map(user.client.cookies);

    const requested = await app.client().post("/api/v1/auth/password/forgot", {
      email: "recover@example.test",
    });
    expect(requested.status).toBe(202);
    const message = findMessage(app.sink, { to: "recover@example.test", subject: "Reset your AURA" });
    const token = tokenFromMessage(message, "/reset-password");
    expect(token).toBeTruthy();

    // The token never appears in a log entry.
    expect(JSON.stringify(app.logs)).not.toContain(token);

    const client = app.client();
    const weak = await client.post("/api/v1/auth/password/reset", {
      token,
      password: "short",
    });
    expect(weak.status).toBe(400);

    const weakMatch = await client.post("/api/v1/auth/password/reset", {
      token,
      password: "another-long-password-1",
    });
    expect(weakMatch.status).toBe(200);

    // Every existing session is revoked.
    const replay = app.client();
    captured.forEach((value, name) => replay.cookies.set(name, value));
    expect((await replay.get("/api/v1/projects")).status).toBe(401);
    const active = await app.db.db.query<{ count: string }>(
      `select count(*)::text as count from aura.sessions s
        join aura.principals p on p.id = s.principal_id
       where p.email = $1 and s.revoked_at is null`,
      ["recover@example.test"]
    );
    expect(active[0]?.count).toBe("0");

    // The reset link is single use and the old password is gone.
    const secondUse = await client.post("/api/v1/auth/password/reset", {
      token,
      password: "yet-another-long-1",
    });
    expect(secondUse.status).toBe(400);
    expect(
      (
        await app.client().post("/api/v1/auth/login", {
          email: "recover@example.test",
          password,
        })
      ).status
    ).toBe(401);
    expect(
      (
        await app.client().post("/api/v1/auth/login", {
          email: "recover@example.test",
          password: "another-long-password-1",
        })
      ).status
    ).toBe(200);
  });

  it("rate limits repeated recovery requests without changing the response", async () => {
    const user = await registerUser(app, { email: "mailbomb@example.test" });
    await verifyEmail(user.client, user.email);
    const before = app.sink.messages.filter(message => message.to.includes("mailbomb@example.test"))
      .length;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await app.client().post("/api/v1/auth/password/forgot", {
        email: "mailbomb@example.test",
      });
      expect(result.status).toBe(202);
      expect(result.body).toEqual({ accepted: true });
    }
    const sent = app.sink.messages.filter(message =>
      message.to.includes("mailbomb@example.test")
    ).length;
    expect(sent - before).toBeLessThanOrEqual(3);
  });
});
