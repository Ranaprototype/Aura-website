/**
 * Disposable PostgreSQL for verification.
 *
 * The engine is PGlite (real PostgreSQL compiled to WebAssembly) exposed over
 * the PostgreSQL wire protocol on loopback, so the production `pg` driver, real
 * roles, real RLS policies, real SECURITY DEFINER functions and a real
 * connection pool are exercised. Nothing here touches a shared or production
 * database: the instance is created in memory for one test file and destroyed.
 *
 * The embedded engine authenticates every connection as an administrator, so
 * the harness assumes the restricted `aura_app` role (transaction locally) for
 * every unit of work. See PgDatabase's `role` option.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PgDatabase } from "../../server/db/database";

const migrationsDirectory = fileURLToPath(
  new URL("../../supabase/migrations", import.meta.url)
);

export interface TestDatabase {
  url: string;
  /** Runtime access exactly as the API uses it: non-owner role. */
  db: PgDatabase;
  /** Administrative handle used only to model an operator/test fixture. */
  admin: PgDatabase;
  close(): Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const engine = new PGlite();
  await engine.waitReady;
  const files = (await readdir(migrationsDirectory))
    .filter(file => file.endsWith(".sql"))
    .sort();
  for (const file of files)
    await engine.exec(await readFile(path.join(migrationsDirectory, file), "utf8"));

  const server = new PGLiteSocketServer({
    db: engine,
    port: 0,
    host: "127.0.0.1",
    maxConnections: 12,
  });
  await server.start();
  const port = Number(server.getServerConn().split(":").at(-1));
  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;

  const db = new PgDatabase({ url, role: "aura_app", max: 4 });
  const admin = new PgDatabase({ url, max: 2 });
  return {
    url,
    db,
    admin,
    async close() {
      await db.close();
      await admin.close();
      await server.stop();
      await engine.close();
    },
  };
}
