/**
 * Full-stack test harness: disposable PostgreSQL, a local SMTP sink and the
 * real Express application with the real auth/email modules. No external
 * service, credential or shared database is used.
 */
import type { Server } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { createApp } from "../../server/app";
import { loadConfig, type AppConfig } from "../../server/config";
import { createServices, type AppServices, type ServiceOverrides } from "../../server/services";
import { createSmtpTransport } from "../../server/email/transport";
import { createLogger } from "../../server/http/logger";
import { startTestDatabase, type TestDatabase } from "./database";
import { startSmtpSink, type LocalSmtpSink } from "./smtp";

export const APP_ORIGIN = "http://127.0.0.1:43001";

export interface ResponseResult<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(private readonly base: string) {}

  cookie(name: string) {
    return this.cookies.get(name);
  }

  private capture(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = attributes.some(attribute => /max-age=0\b/i.test(attribute));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    {
      body,
      headers = {},
      csrf = true,
      cookieJar = true,
    }: {
      body?: unknown;
      headers?: Record<string, string>;
      csrf?: boolean;
      cookieJar?: boolean;
    } = {}
  ): Promise<ResponseResult<T>> {
    // A real browser primes the double-submit cookie with a safe request before
    // its first POST; mirror that so the client never needs a bypass.
    if (method !== "GET" && csrf && !this.cookies.get("aura_csrf")) {
      await fetch(`${this.base}/api/v1/auth/session`);
      const primed = await fetch(`${this.base}/api/v1/auth/session`);
      this.capture(primed);
    }
    const requestHeaders: Record<string, string> = { ...headers };
    if (body !== undefined) requestHeaders["content-type"] = "application/json";
    if (csrf && method !== "GET") {
      const token = this.cookies.get("aura_csrf");
      if (token) requestHeaders["x-csrf-token"] = token;
    }
    if (cookieJar && this.cookies.size) {
      const pairs: string[] = [];
      this.cookies.forEach((value, name) => pairs.push(`${name}=${value}`));
      requestHeaders.cookie = pairs.join("; ");
    }
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    this.capture(response);
    const text = await response.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return {
      status: response.status,
      body: parsed as T,
      headers: response.headers,
    };
  }

  get<T = Record<string, unknown>>(path: string, options?: Parameters<TestClient["request"]>[2]) {
    return this.request<T>("GET", path, options);
  }

  post<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    options?: Parameters<TestClient["request"]>[2]
  ) {
    return this.request<T>("POST", path, { ...options, body });
  }

  put<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    options?: Parameters<TestClient["request"]>[2]
  ) {
    return this.request<T>("PUT", path, { ...options, body });
  }

  patch<T = Record<string, unknown>>(
    path: string,
    body?: unknown,
    options?: Parameters<TestClient["request"]>[2]
  ) {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  delete<T = Record<string, unknown>>(path: string, options?: Parameters<TestClient["request"]>[2]) {
    return this.request<T>("DELETE", path, { ...options });
  }
}

export interface TestApp {
  baseUrl: string;
  db: TestDatabase;
  sink: LocalSmtpSink;
  logs: Array<Record<string, string | number | boolean>>;
  services: AppServices;
  config: AppConfig;
  client(): TestClient;
  close(): Promise<void>;
}

export function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: "test",
    APP_ORIGIN,
    SMTP_URL: "smtp://127.0.0.1:2525",
    EMAIL_FROM: "AURA <no-reply@aura.test>",
    // A single verification run creates many accounts from one loopback
    // address; the limiter itself is asserted with a low value in its own case.
    AUTH_REGISTER_HOURLY_LIMIT: "500",
    AUTH_LOGIN_IP_LIMIT: "5000",
    AUTH_LOGIN_EMAIL_LIMIT: "100",
    ...overrides,
  });
}

/**
 * Reserves a concrete loopback port so the configured application origin is the
 * same origin the browser actually uses; the origin check stays strict instead
 * of being relaxed for tests.
 */
async function reservePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", () => resolve()));
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

export async function startTestApp({
  config: configOverrides = {},
  transport,
  services: serviceOverrides,
  identity,
  staticPath,
}: {
  config?: NodeJS.ProcessEnv;
  transport?: ServiceOverrides["transport"];
  services?: Partial<ServiceOverrides>;
  identity?: ServiceOverrides["identity"];
  /** Serve a compiled SPA for browser tests. */
  staticPath?: string;
} = {}): Promise<TestApp> {
  const db = await startTestDatabase();
  const sink = await startSmtpSink();
  const logs: TestApp["logs"] = [];
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const config = testConfig({
    DATABASE_URL: db.url,
    SMTP_URL: sink.url,
    APP_ORIGIN: origin,
    ...configOverrides,
  });
  const services = createServices(config, {
    db: db.db,
    // Phase 4: the anonymous public pool is available by default so storefront
    // routes work; a test can pass services:{publicDb:undefined} to assert 503.
    publicDb: db.publicDb,
    transport:
      transport ??
      createSmtpTransport({ url: sink.url, from: "AURA <no-reply@aura.test>" }),
    logger: createLogger(entry => logs.push(entry)),
    appOrigin: config.appOrigin ?? origin,
    sleep: async () => {},
    identity,
    ...serviceOverrides,
  });
  if (!services) throw new Error("Services unavailable");

  const server: Server = await new Promise(resolve => {
    const instance = createApp({ services, staticPath }).listen(port, "127.0.0.1", () =>
      resolve(instance)
    );
  });

  return {
    baseUrl: origin,
    db,
    sink,
    logs,
    services,
    config,
    client: () => new TestClient(origin),
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await services.close();
      await sink.close();
      await db.close();
    },
  };
}

/** Convenience: a registered, verified account with its own cookie jar. */
export async function registerUser(
  app: TestApp,
  {
    email,
    password = "correct-horse-battery-9",
    displayName = "Test User",
  }: { email: string; password?: string; displayName?: string }
) {
  const client = app.client();
  const registration = await client.post<{
    principal: { id: string };
    organizations: Array<{ id: string; role: string }>;
  }>("/api/v1/auth/register", {
    email,
    password,
    displayName,
  });
  if (registration.status !== 201)
    throw new Error(`registration failed: ${registration.status} ${JSON.stringify(registration.body)}`);
  return {
    client,
    email,
    password,
    principalId: registration.body.principal.id,
    organizationId: registration.body.organizations[0]?.id ?? "",
  };
}
