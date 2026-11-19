import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createApp } from "../server/app";
import { createStore } from "../server/lib/supabase";

// Control only the upstream HTTP response. Express, authorization, SDK, actual
// loopback transport, timeout and database adapter all run unchanged.
let provider: Server, api: Server, base: string;
let reply: { status: number; body: string; mime?: string; hang?: boolean };
let requestPath: string | undefined;
const fixture = {
  id: "99b48125-e2d2-4592-9a6c-7b8d6d16b632",
  message: "fixture",
  created_at: "2026-11-19T00:00:00+00:00",
};
const origin = (s: Server) =>
  `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
beforeAll(async () => {
  provider = createServer((req, res) => {
    requestPath = req.url;
    if (!reply.hang)
      res
        .writeHead(reply.status, {
          "Content-Type": reply.mime ?? "application/json",
        })
        .end(reply.body);
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  api = createApp({
    store: createStore({
      url: origin(provider),
      key: "sb_publishable_fixture",
    }),
    diagnosticToken: "fixture",
  }).listen(0, "127.0.0.1");
  await once(api, "listening");
  base = origin(api);
});
afterAll(async () => {
  for (const s of [api, provider]) {
    const done = once(s, "close");
    s.close();
    s.closeAllConnections();
    await done;
  }
});
async function call(operation: "ready" | "list" | "insert") {
  requestPath = undefined;
  const response = await fetch(
    base + (operation === "ready" ? "/api/health/ready" : "/api/hello"),
    {
      method: operation === "insert" ? "POST" : "GET",
      headers: {
        Authorization: "Bearer fixture",
        "Content-Type": "application/json",
      },
      body:
        operation === "insert"
          ? JSON.stringify({ message: fixture.message })
          : undefined,
    }
  );
  expect(requestPath).toMatch(/^\/rest\/v1\/hello\?/);
  return { status: response.status, body: await response.json() };
}
for (const operation of ["ready", "list", "insert"] as const) {
  const ok = operation === "insert" ? 201 : 200;
  it.each([
    [404, ""],
    [404, "[]"],
    [403, '{"message":"private provider details"}'],
    [ok, ""],
    [ok, "null"],
    [ok, "not json"],
    [ok, '{"unexpected":true}'],
    [ok, '[{"id":"invalid"}]'],
  ] as const)(`${operation} rejects upstream %i %s`, async (status, body) => {
    reply = { status, body };
    expect(await call(operation)).toEqual({
      status: 503,
      body: {
        error: operation === "ready" ? "not_ready" : "database_unavailable",
      },
    });
  });
}
it("readiness accepts a valid empty relation; list accepts valid empty and populated results", async () => {
  reply = { status: 200, body: "[]" };
  expect(await call("ready")).toEqual({
    status: 200,
    body: { status: "ready" },
  });
  expect(await call("list")).toEqual({ status: 200, body: { data: [] } });
  reply = { status: 206, body: JSON.stringify([fixture]) };
  expect(await call("list")).toEqual({
    status: 200,
    body: { data: [fixture] },
  });
});
it("requires the actual insert status, JSON representation and matching returned row", async () => {
  for (const bad of [
    { status: 200, body: JSON.stringify(fixture) },
    { status: 201, body: JSON.stringify(fixture), mime: "text/html" },
    { status: 201, body: JSON.stringify({ ...fixture, message: "different" }) },
    { status: 409, body: '{"message":"private conflict"}' },
  ]) {
    reply = bad;
    expect(await call("insert")).toEqual({
      status: 503,
      body: { error: "database_unavailable" },
    });
  }
  reply = {
    status: 201,
    body: JSON.stringify(fixture),
    mime: "application/vnd.pgrst.object+json",
  };
  expect(await call("insert")).toEqual({
    status: 201,
    body: { data: fixture },
  });
});
it("aborts a stalled read and reports generic unavailable readiness", async () => {
  reply = { status: 200, body: "", hang: true };
  expect(await call("ready")).toEqual({
    status: 503,
    body: { error: "not_ready" },
  });
});
