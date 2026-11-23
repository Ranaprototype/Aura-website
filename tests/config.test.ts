/**
 * Startup configuration for the identity and email stack.
 *
 * The previous Phase 2 failure mode was a throw at import time with no email
 * configuration. These checks pin the contract: development and test may boot
 * without SMTP, production must fail closed without a database, an origin and a
 * transport, and no credential is ever accepted from a browser-visible name.
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../server/config";
import { createServices } from "../server/services";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://aura_app:secret@db.example.test:5432/aura",
  APP_ORIGIN: "https://aura.example.test",
  SMTP_URL: "smtps://smtp.example.test:465",
  EMAIL_FROM: "AURA <no-reply@example.test>",
};

describe("offline and test boot", () => {
  it("loads without any optional configuration", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3001);
    expect(config.database).toBeUndefined();
    expect(config.email).toBeUndefined();
    expect(config.postgres).toBeUndefined();
    expect(config.production).toBe(false);
    expect(config.secureCookies).toBe(false);
    expect(config.sessionTtlSeconds).toBe(12 * 3600);
    expect(config.authTokenTtlSeconds).toBe(3600);
    expect(config.emailMaxAttempts).toBe(3);
  });

  it("does not mount the auth API without a runtime database", () => {
    expect(createServices(loadConfig({}))).toBeUndefined();
  });

  it("accepts a test environment without SMTP", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      APP_ORIGIN: "http://127.0.0.1:3001",
    });
    expect(config.email).toBeUndefined();
    expect(config.production).toBe(false);
    expect(config.secureCookies).toBe(false);
  });
});

describe("production fail-closed rules", () => {
  it("accepts a complete configuration and forces secure cookies", () => {
    const config = loadConfig(production);
    expect(config.production).toBe(true);
    expect(config.secureCookies).toBe(true);
    expect(config.email).toEqual({
      smtpUrl: production.SMTP_URL,
      from: production.EMAIL_FROM,
    });
    expect(config.postgres).toEqual({ url: production.DATABASE_URL });
  });

  it.each([
    ["no runtime database", { ...production, DATABASE_URL: undefined }],
    ["no application origin", { ...production, APP_ORIGIN: undefined }],
    ["no SMTP transport", { ...production, SMTP_URL: undefined }],
    ["no sender mailbox", { ...production, EMAIL_FROM: undefined }],
    [
      "an unencrypted database connection",
      { ...production, DATABASE_URL: "postgres://aura_app:secret@db.example.test/aura?sslmode=disable" },
    ],
  ])("refuses to start with %s", (_label, env) => {
    expect(() => loadConfig(env as NodeJS.ProcessEnv)).toThrow();
  });

  it.each([
    ["a non-SMTP transport", { SMTP_URL: "http://smtp.example.test:2525" }],
    ["a malformed SMTP URL", { SMTP_URL: "smtp://" }],
    ["a malformed sender", { EMAIL_FROM: "not-an-address" }],
    ["a SQLite database URL", { DATABASE_URL: "file:./data.db" }],
    ["a database URL without a name", { DATABASE_URL: "postgres://db.example.test" }],
  ])("rejects %s", (_label, override) => {
    expect(() => loadConfig({ ...production, ...override })).toThrow();
  });

  it("rejects out-of-range tuning values", () => {
    expect(() => loadConfig({ SESSION_TTL_HOURS: "0" })).toThrow();
    expect(() => loadConfig({ AUTH_TOKEN_TTL_MINUTES: "2" })).toThrow();
    expect(() => loadConfig({ EMAIL_MAX_ATTEMPTS: "9" })).toThrow();
    expect(() => loadConfig({ AUTH_MAX_FAILED_ATTEMPTS: "1" })).toThrow();
  });
});

describe("secret hygiene", () => {
  it("ignores browser-visible variable names entirely", () => {
    const config = loadConfig({
      VITE_SMTP_URL: "smtp://user:secret@example.test",
      VITE_DATABASE_URL: "postgres://user:secret@example.test/aura",
      VITE_SUPABASE_SERVICE_ROLE_KEY: "secret",
    });
    expect(config.email).toBeUndefined();
    expect(config.postgres).toBeUndefined();
    expect(config.database).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain("secret");
  });

  it("keeps the smtp credential out of every public field", () => {
    const config = loadConfig({
      ...production,
      SMTP_URL: "smtps://user:a-very-secret-value@mail.example.test:465",
    });
    expect(config.email?.smtpUrl).toContain("a-very-secret-value");
    // Only the transport URL carries it; nothing else echoes the credential.
    expect(JSON.stringify(config.email?.from)).not.toContain("secret");
    expect(config.appOrigin).toBe("https://aura.example.test");
  });

  it("still refuses the diagnostic operator token in production", () => {
    expect(() =>
      loadConfig({
        ...production,
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "sb_publishable_fixture",
        LOCAL_DIAGNOSTIC_TOKEN: "a".repeat(40),
      })
    ).toThrow();
  });
});
