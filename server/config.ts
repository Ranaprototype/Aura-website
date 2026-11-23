import { z } from "zod";

import { apiPort } from "./environment";

function safeKey(key: string) {
  if (/^sb_publishable_[\w-]+$/.test(key)) return true;
  try {
    const parts = key.split(".");
    return (
      parts.length === 3 &&
      JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "anon"
    );
  } catch {
    return false;
  }
}

// Display name plus address, e.g. `AURA <no-reply@example.test>`.
const mailbox = z
  .string()
  .max(320)
  .regex(/^(?:[^<>]{1,80}<\s*)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]{2,}(?:\s*>)?$/);

const smtpUrl = z
  .string()
  .max(2048)
  .refine(value => {
    try {
      const url = new URL(value);
      return (
        ["smtp:", "smtps:"].includes(url.protocol) &&
        Boolean(url.hostname) &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Invalid SMTP URL");

const postgresUrl = z
  .string()
  .max(2048)
  .refine(value => {
    try {
      const url = new URL(value);
      return (
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        Boolean(url.hostname) &&
        Boolean(url.pathname.replace("/", "")) &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Invalid PostgreSQL URL");

export function loadConfig(env: NodeJS.ProcessEnv) {
  const config = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      SUPABASE_URL: z.string().url().optional(),
      SUPABASE_ANON_KEY: z.string().refine(safeKey).optional(),
      LOCAL_DIAGNOSTIC_TOKEN: z.string().min(32).optional(),
      // Server-only runtime database. Never a VITE_* variable and never sent to
      // the browser; the login it uses is the restricted `aura_app` role.
      DATABASE_URL: postgresUrl.optional(),
      APP_ORIGIN: z.string().url().optional(),
      SMTP_URL: smtpUrl.optional(),
      EMAIL_FROM: mailbox.optional(),
      SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
      AUTH_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
      EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
      AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(8),
      AUTH_REGISTER_HOURLY_LIMIT: z.coerce.number().int().min(1).max(10_000).default(20),
      AUTH_LOGIN_IP_LIMIT: z.coerce.number().int().min(5).max(10_000).default(60),
      AUTH_LOGIN_EMAIL_LIMIT: z.coerce.number().int().min(3).max(1_000).default(10),
    })
    .safeParse(env);
  if (!config.success) throw new Error("Invalid server configuration");
  const {
    NODE_ENV,
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    LOCAL_DIAGNOSTIC_TOKEN,
    DATABASE_URL,
    APP_ORIGIN,
    SMTP_URL,
    EMAIL_FROM,
    SESSION_TTL_HOURS,
    AUTH_TOKEN_TTL_MINUTES,
    EMAIL_MAX_ATTEMPTS,
    AUTH_MAX_FAILED_ATTEMPTS,
    AUTH_REGISTER_HOURLY_LIMIT,
    AUTH_LOGIN_IP_LIMIT,
    AUTH_LOGIN_EMAIL_LIMIT,
  } = config.data;
  if (Boolean(SUPABASE_URL) !== Boolean(SUPABASE_ANON_KEY))
    throw new Error("Database settings must be supplied together");
  const url = SUPABASE_URL ? new URL(SUPABASE_URL) : undefined;
  const local = url && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url &&
    (url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(url.protocol === "https:" || (local && url.protocol === "http:")))
  )
    throw new Error("Invalid database URL");
  if (LOCAL_DIAGNOSTIC_TOKEN && (!local || NODE_ENV === "production"))
    throw new Error(
      "Diagnostics require a local test database outside production"
    );

  const production = NODE_ENV === "production";
  if (production) {
    // Fail closed: a production process never starts with an unverifiable
    // identity path, an insecure origin or no way to deliver a reset email.
    if (!DATABASE_URL) throw new Error("Production requires a runtime database");
    if (!APP_ORIGIN) throw new Error("Production requires an application origin");
    if (!SMTP_URL) throw new Error("Production requires an SMTP transport");
    if (!EMAIL_FROM) throw new Error("Production requires a sender mailbox");
    if (/[?&]sslmode=disable(?:&|$)/.test(DATABASE_URL))
      throw new Error("Production requires TLS to the runtime database");
  }

  const origin = APP_ORIGIN ? new URL(APP_ORIGIN).origin : undefined;
  if (origin && !/^https?:$/.test(new URL(origin).protocol))
    throw new Error("Invalid application origin");

  return {
    port: apiPort(env.PORT),
    nodeEnv: NODE_ENV,
    production,
    database:
      SUPABASE_URL && SUPABASE_ANON_KEY
        ? { url: SUPABASE_URL, key: SUPABASE_ANON_KEY }
        : undefined,
    diagnosticToken: LOCAL_DIAGNOSTIC_TOKEN,
    postgres: DATABASE_URL ? { url: DATABASE_URL } : undefined,
    appOrigin: origin,
    email: SMTP_URL && EMAIL_FROM ? { smtpUrl: SMTP_URL, from: EMAIL_FROM } : undefined,
    sessionTtlSeconds: SESSION_TTL_HOURS * 3600,
    authTokenTtlSeconds: AUTH_TOKEN_TTL_MINUTES * 60,
    emailMaxAttempts: EMAIL_MAX_ATTEMPTS,
    authMaxFailedAttempts: AUTH_MAX_FAILED_ATTEMPTS,
    limits: {
      registerHourly: AUTH_REGISTER_HOURLY_LIMIT,
      loginIp: AUTH_LOGIN_IP_LIMIT,
      loginEmail: AUTH_LOGIN_EMAIL_LIMIT,
    },
    // Secure cookies are mandatory in production and whenever the configured
    // origin is HTTPS; plain-HTTP development keeps the flag off so the loop
    // works, and `SameSite=Lax` still blocks cross-site POSTs.
    secureCookies: production || Boolean(origin?.startsWith("https://")),
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
