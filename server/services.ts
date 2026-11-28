import type { AppConfig } from "./config";
import { AuthStore } from "./auth/store";
import { createSupabaseIdentityProvider, type IdentityProvider } from "./auth/identity";
import { PgDatabase, type Database } from "./db/database";
import { EmailService, PgEmailStore, type EmailTransport } from "./email/service";
import { createSmtpTransport } from "./email/transport";
import { createLogger, type Logger } from "./http/logger";
import { randomBytes } from "node:crypto";

/** Dev/test only: a per-process cursor key. Cursors do not survive restarts. */
const ephemeralCursorSecret = () => randomBytes(32).toString("hex");

/**
 * Server-only composition root. Every dependency here is either configuration
 * or a server-side object; the browser receives none of it.
 */
export interface AppServices {
  db: Database;
  /** Phase 4 anonymous read pool (restricted aura_public). Absent => 503. */
  publicDb?: Database;
  /** HMAC secret for signed discovery cursors (ephemeral in dev/test). */
  publicCursorSecret: string;
  /** Per-IP public read budget (requests/minute). */
  publicReadIpLimit: number;
  /** Express `trust proxy` setting for the public limiter's client IP. */
  trustProxy: boolean | number | string;
  auth: AuthStore;
  email?: EmailService;
  identity?: IdentityProvider;
  logger: Logger;
  appOrigin: string;
  secureCookies: boolean;
  production: boolean;
  limits: {
    registerHourly: number;
    loginIp: number;
    loginEmail: number;
  };
  close(): Promise<void>;
}

export interface ServiceOverrides {
  db?: Database;
  publicDb?: Database;
  transport?: EmailTransport;
  identity?: IdentityProvider | null;
  logger?: Logger;
  appOrigin?: string;
  sleep?: (ms: number) => Promise<void>;
}

export function createServices(
  config: AppConfig,
  overrides: ServiceOverrides = {}
): AppServices | undefined {
  const db =
    overrides.db ??
    (config.postgres ? new PgDatabase({ url: config.postgres.url }) : undefined);
  if (!db) return undefined;

  // The public pool is a SEPARATE connection pool on the restricted
  // `aura_public` login. It never binds a principal and never reaches identity
  // tables. Absent config => the storefront fails closed (503), never falling
  // back to the app pool.
  const publicDb =
    overrides.publicDb ??
    (config.publicPostgres
      ? new PgDatabase({ url: config.publicPostgres.url, max: 4 })
      : undefined);

  const logger = overrides.logger ?? createLogger();
  const auth = new AuthStore(db, {
    sessionTtlSeconds: config.sessionTtlSeconds,
    tokenTtlSeconds: config.authTokenTtlSeconds,
    maxFailedAttempts: config.authMaxFailedAttempts,
  });

  const transport =
    overrides.transport ??
    (config.email
      ? createSmtpTransport({ url: config.email.smtpUrl, from: config.email.from })
      : undefined);

  const email = transport
    ? new EmailService({
        store: new PgEmailStore(db),
        transport,
        logger,
        maxAttempts: config.emailMaxAttempts,
        sleep: overrides.sleep,
      })
    : undefined;

  const identity =
    overrides.identity === null
      ? undefined
      : (overrides.identity ??
        (config.database
          ? createSupabaseIdentityProvider({
              url: config.database.url,
              anonKey: config.database.key,
            })
          : undefined));

  return {
    db,
    publicDb,
    publicCursorSecret: config.publicCursorSecret ?? ephemeralCursorSecret(),
    publicReadIpLimit: config.publicReadIpLimit,
    trustProxy: config.trustProxy,
    auth,
    email,
    identity,
    logger,
    appOrigin: overrides.appOrigin ?? config.appOrigin ?? `http://127.0.0.1:${config.port}`,
    secureCookies: config.secureCookies,
    production: config.production,
    limits: config.limits,
    async close() {
      await email?.close();
      await publicDb?.close();
      await db.close();
    },
  };
}
