import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app";
import { apiPort, serverEnvironment } from "../server/environment";
import { loadConfig } from "../server/config";
let root: string, server: Server, base: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "aura-routes-"));
  await writeFile(join(root, "index.html"), "<html>fixture shell</html>");
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets/app.js"), "//fixture");
  server = createApp({ staticPath: root }).listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  const done = once(server, "close");
  server.close();
  await done;
  await rm(root, { recursive: true });
});
it.each([
  "/__manus__/debug-collector.js",
  "/__manus__/logs",
  "/manus-storage",
  "/manus-storage/key",
])("retires %s before static handling", async path => {
  for (const method of ["GET", "POST"]) {
    const r = await fetch(base + path, { method });
    expect(r.status).toBe(410);
    expect(await r.json()).toEqual({ error: "gone" });
  }
});
it.each([
  "/assets/missing.js",
  "/assets/missing",
  "/models/missing.glb",
  "/absent.png",
  "/api/missing",
  "/missing-page",
])("does not serve HTML for %s", async path => {
  const r = await fetch(base + path, { headers: { Accept: "text/html" } });
  expect(r.status).toBe(404);
  expect(await r.text()).not.toContain("fixture shell");
});
it.each([
  "/cart",
  "/checkout/",
  "/order-confirmation?order=fixture",
  "/catalog",
  "/category/sneakers",
  "/product/sneaker",
  "/products/fixture",
  "/order/fixture",
  "/account/orders/fixture",
  "/compare?products=a,b",
  "/seller",
  "/seller/products",
  "/seller/products/22222222-2222-4222-8222-222222222222",
  "/admin/review",
])("preserves document %s", async path => {
  const r = await fetch(base + path);
  expect(r.status).toBe(200);
  expect(await r.text()).toContain("fixture shell");
});
it("serves existing static assets", async () =>
  expect(await (await fetch(base + "/assets/app.js")).text()).toBe(
    "//fixture"
  ));
it("uses shell > .env.local > 3001 in both consumers, ignoring mode-specific files", async () => {
  await writeFile(join(root, ".env.development"), "PORT=9000");
  const both = (shell: NodeJS.ProcessEnv, value: number) => {
    const env = serverEnvironment(root, shell);
    expect(apiPort(env.PORT)).toBe(value);
    expect(loadConfig(env).port).toBe(value);
  };
  both({}, 3001);
  await writeFile(join(root, ".env.local"), "PORT=3101");
  both({}, 3101);
  both({ PORT: "3102" }, 3102);
  for (const bad of ["", "0", "1.2", "65536", "not-a-port"]) {
    expect(() => apiPort(bad)).toThrow();
    expect(() => loadConfig({ PORT: bad })).toThrow();
  }
});
