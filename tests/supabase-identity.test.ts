/**
 * Supabase identity verification. A loopback HTTP responder stands in for the
 * issuer's `/auth/v1/user` endpoint (no Supabase project, account or key is
 * used). The provider must reject anything that is not a strict, successful,
 * JSON user document — a browser cannot assert an identity.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseIdentityProvider } from "../server/auth/identity";
import { startTestApp, type TestApp } from "./support/app";

let issuer: Server;
let issuerUrl: string;
let app: TestApp;
let unconfigured: TestApp;

const profiles: Record<string, unknown> = {
  "valid-token-0123456789abcdef": {
    id: "f3c1a4d2-8f0b-4a2e-9e1d-2f1a5b6c7d8e",
    email: "Provider.User@Example.Test",
    email_confirmed_at: "2026-11-01T10:00:00.000Z",
  },
  "unverified-token-0123456789abcdef": {
    id: "0b2c3d4e-5f60-4718-9abc-def012345678",
    email: "unverified-provider@example.test",
  },
  "missing-email-token-0123456789": { id: "11111111-2222-4333-8444-555555555555" },
};

beforeAll(async () => {
  issuer = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/auth/v1/user") {
      res.writeHead(404).end();
      return;
    }
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (req.headers.apikey !== "sb_publishable_fixture") {
      res.writeHead(401, { "content-type": "application/json" }).end('{"error":"no key"}');
      return;
    }
    if (token === "html-token-0123456789abcdef") {
      res.writeHead(200, { "content-type": "text/html" }).end("<html>not json</html>");
      return;
    }
    if (token === "slow-token-0123456789abcdef") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      }, 400);
      return;
    }
    const profile = profiles[token];
    if (!profile) {
      res.writeHead(401, { "content-type": "application/json" }).end('{"error":"bad token"}');
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(profile));
  });
  await new Promise<void>(resolve => issuer.listen(0, "127.0.0.1", () => resolve()));
  issuerUrl = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`;

  const identity = createSupabaseIdentityProvider({
    url: issuerUrl,
    anonKey: "sb_publishable_fixture",
    timeoutMs: 200,
  });
  app = await startTestApp({ identity });
  unconfigured = await startTestApp({ identity: null });
});

afterAll(async () => {
  await app.close();
  await unconfigured.close();
  await new Promise<void>(resolve => issuer.close(() => resolve()));
});

describe("access token verification", () => {
  it("accepts a strict JSON user document and derives the subject from it", async () => {
    const provider = createSupabaseIdentityProvider({
      url: issuerUrl,
      anonKey: "sb_publishable_fixture",
      timeoutMs: 500,
    });
    const identity = await provider.verify("valid-token-0123456789abcdef");
    expect(identity).toEqual({
      issuer: "supabase",
      subject: "f3c1a4d2-8f0b-4a2e-9e1d-2f1a5b6c7d8e",
      email: "provider.user@example.test",
      emailVerified: true,
    });
  });

  it.each([
    ["a rejected token", "unknown-token-0123456789abcdef"],
    ["a non-JSON response", "html-token-0123456789abcdef"],
    ["a too-short token", "short"],
    ["an oversized token", "x".repeat(5000)],
  ])("rejects %s", async (_label, token) => {
    const provider = createSupabaseIdentityProvider({
      url: issuerUrl,
      anonKey: "sb_publishable_fixture",
      timeoutMs: 500,
    });
    await expect(provider.verify(token)).rejects.toThrow(/Identity verification failed/);
  });

  it("rejects a profile without an email", async () => {
    const provider = createSupabaseIdentityProvider({
      url: issuerUrl,
      anonKey: "sb_publishable_fixture",
      timeoutMs: 500,
    });
    await expect(provider.verify("missing-email-token-0123456789")).rejects.toThrow(
      /Identity verification failed/
    );
  });

  it("times out instead of trusting a slow issuer", async () => {
    const provider = createSupabaseIdentityProvider({
      url: issuerUrl,
      anonKey: "sb_publishable_fixture",
      timeoutMs: 50,
    });
    await expect(provider.verify("slow-token-0123456789abcdef")).rejects.toThrow();
  });
});

describe("provider session exchange", () => {
  it("creates a server-side session for a verified provider identity", async () => {
    const client = app.client();
    const result = await client.post<{
      principal: { id: string; email: string; emailVerified: boolean };
    }>("/api/v1/auth/supabase", { accessToken: "valid-token-0123456789abcdef" });
    expect(result.status).toBe(200);
    expect(result.body.principal.email).toBe("provider.user@example.test");
    expect(result.body.principal.emailVerified).toBe(true);

    const stored = await app.db.admin.query<{ issuer: string; subject: string }>(
      `select issuer, subject from aura.principals where id = $1`,
      [result.body.principal.id]
    );
    expect(stored[0]).toEqual({
      issuer: "supabase",
      subject: "f3c1a4d2-8f0b-4a2e-9e1d-2f1a5b6c7d8e",
    });

    const session = await client.get<{ authenticated: boolean }>("/api/v1/auth/session");
    expect(session.body.authenticated).toBe(true);

    // A second exchange maps onto the same principal.
    const again = await app.client().post<{ principal: { id: string } }>(
      "/api/v1/auth/supabase",
      { accessToken: "valid-token-0123456789abcdef" }
    );
    expect(again.body.principal.id).toBe(result.body.principal.id);
  });

  it("rejects a forged or rejected token and any extra identity fields", async () => {
    const client = app.client();
    const rejected = await client.post("/api/v1/auth/supabase", {
      accessToken: "forged-token-0123456789abcdef",
    });
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual({ error: "invalid_credentials" });

    const smuggling = await client.post("/api/v1/auth/supabase", {
      accessToken: "valid-token-0123456789abcdef",
      email: "attacker@example.test",
      subject: "attacker",
      role: "owner",
    });
    expect(smuggling.status).toBe(400);

    expect((await client.get("/api/v1/auth/session")).body).toEqual({ authenticated: false });
  });

  it("marks an unconfirmed provider address as unverified", async () => {
    const client = app.client();
    const result = await client.post<{ principal: { emailVerified: boolean } }>(
      "/api/v1/auth/supabase",
      { accessToken: "unverified-token-0123456789abcdef" }
    );
    expect(result.status).toBe(200);
    expect(result.body.principal.emailVerified).toBe(false);
    const blocked = await client.get("/api/v1/projects");
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ error: "email_unverified" });
  });

  it("answers 501 when no identity provider is configured", async () => {
    const result = await unconfigured.client().post("/api/v1/auth/supabase", {
      accessToken: "valid-token-0123456789abcdef",
    });
    expect(result.status).toBe(501);
    expect(result.body).toEqual({ error: "identity_provider_unavailable" });
  });
});
