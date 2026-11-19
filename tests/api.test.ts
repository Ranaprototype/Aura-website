import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app";
import { loadConfig } from "../server/config";

// Private ephemeral listeners and an injected diagnostic store; never contact Supabase.
const token = "synthetic-unit-test-only-not-a-production-token";
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const store = {
  ready: vi.fn(async () => {}),
  recent: vi.fn(async () => []),
  add: vi.fn(async (message: string) => ({ message })),
};
const servers: Server[] = [];
async function listen(app: ReturnType<typeof createApp>) {
  const server = await new Promise<Server>(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}
let base: string, offline: string;
beforeAll(async () => {
  base = await listen(createApp({ store, diagnosticToken: token }));
  offline = await listen(createApp());
});
afterAll(async () => {
  await Promise.all(
    servers.map(
      s =>
        new Promise<void>((resolve, reject) =>
          s.close(e => (e ? reject(e) : resolve()))
        )
    )
  );
});
beforeEach(() => vi.clearAllMocks());
async function failure(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}
it("keeps liveness independent of database configuration", async () => {
  expect(await (await fetch(`${offline}/health/live`)).json()).toEqual({
    status: "alive",
  });
  await failure(await fetch(`${offline}/health/ready`), 503, "not_ready");
  expect(await (await fetch(`${base}/health`)).json()).toEqual({
    status: "ready",
  });
  store.ready.mockRejectedValueOnce(Error("private diagnostic detail"));
  await failure(await fetch(`${base}/health/ready`), 503, "not_ready");
});
it.each(["/hello", "/orders", "/payments", "/auth/login", "/unknown"])(
  "fails closed without a configured operation: %s",
  async path => {
    await failure(await fetch(offline + path), 404, "not_found");
    await failure(
      await fetch(offline + path, { method: "POST" }),
      404,
      "not_found"
    );
  }
);
it("denies missing, incorrect and browser-origin credentials before processing input", async () => {
  for (const extra of [
    {},
    { Authorization: "Bearer wrong" },
    { Authorization: headers.Authorization, Origin: "https://example.invalid" },
  ]) {
    await failure(
      await fetch(`${base}/hello`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extra },
        body: "not json",
      }),
      403,
      "forbidden"
    );
  }
  expect(store.add).not.toHaveBeenCalled();
});
it.each([
  ["application/json", "{", 400, "invalid_json"],
  ["application/json", '{"message":" "}', 400, "invalid_message"],
  [
    "application/json",
    JSON.stringify({ message: "x".repeat(201) }),
    400,
    "invalid_message",
  ],
  [
    "application/json",
    JSON.stringify({ message: "ok", other: true }),
    400,
    "invalid_message",
  ],
  ["text/plain", "invalid", 415, "unsupported_media_type"],
  [
    "application/json",
    JSON.stringify({ message: "x".repeat(5000) }),
    413,
    "payload_too_large",
  ],
] as const)(
  "validates authorized request (%s → %s)",
  async (type, body, status, code) => {
    await failure(
      await fetch(`${base}/hello`, {
        method: "POST",
        headers: { ...headers, "Content-Type": type },
        body,
      }),
      status,
      code
    );
    expect(store.add).not.toHaveBeenCalled();
  }
);
it("handles local operator reads/writes and sanitizes provider errors", async () => {
  const post = () =>
    fetch(`${base}/hello`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: " test " }),
    });
  expect((await post()).status).toBe(201);
  expect(store.add).toHaveBeenCalledWith("test");
  expect(await (await fetch(`${base}/hello`, { headers })).json()).toEqual({
    data: [],
  });
  store.add.mockRejectedValueOnce(Error("private connection details"));
  await failure(await post(), 503, "database_unavailable");
});
describe("startup configuration", () => {
  const local = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: "sb_publishable_fixture",
  };
  it("permits offline boot and explicit local diagnostics", () => {
    expect(loadConfig({}).database).toBeUndefined();
    expect(loadConfig({ ...local, LOCAL_DIAGNOSTIC_TOKEN: token }).port).toBe(
      3001
    );
  });
  it.each([
    { PORT: "0" },
    { SUPABASE_URL: local.SUPABASE_URL },
    { ...local, SUPABASE_ANON_KEY: "sb_secret_fixture" },
    { ...local, SUPABASE_URL: "http://example.invalid" },
    { ...local, NODE_ENV: "production", LOCAL_DIAGNOSTIC_TOKEN: token },
    {
      ...local,
      SUPABASE_URL: "https://example.invalid",
      LOCAL_DIAGNOSTIC_TOKEN: token,
    },
  ])("rejects invalid or privileged configuration", env => {
    expect(() => loadConfig(env)).toThrow();
  });
});
