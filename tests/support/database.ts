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
import { PgDatabase, type Transaction } from "../../server/db/database";

const migrationsDirectory = fileURLToPath(
  new URL("../../supabase/migrations", import.meta.url)
);

export interface TestDatabase {
  url: string;
  /** Runtime access exactly as the API uses it: non-owner role. */
  db: PgDatabase;
  /** Phase 4 anonymous public read pool: restricted aura_public, no principal. */
  publicDb: PgDatabase;
  /** Administrative handle used only to model an operator/test fixture. */
  admin: PgDatabase;
  close(): Promise<void>;
}

/**
 * PGlite's wire server multiplexes every client onto one SQL session, so the
 * extended protocol's unnamed statement can be replaced between the Parse and
 * the Bind of a concurrent request ("unnamed prepared statement does not
 * exist"). The engine is single-session anyway, so units of work are serialized
 * across both handles: the pool still opens real connections and every query
 * still runs through the driver, but two requests never interleave their
 * protocol messages. Managed PostgreSQL is unaffected.
 */
function serializeUnitsOfWork(...handles: PgDatabase[]): void {
  let tail: Promise<unknown> = Promise.resolve();
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
  for (const handle of handles) {
    const query = handle.query.bind(handle);
    const transaction = handle.transaction.bind(handle);
    handle.query = ((sql: string, params?: readonly unknown[]) =>
      run(() => query(sql, params))) as PgDatabase["query"];
    handle.transaction = (<T>(work: (tx: Transaction) => Promise<T>) =>
      run(() => transaction(work))) as PgDatabase["transaction"];
  }
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const engine = new PGlite();
  await engine.waitReady;
  const files = (await readdir(migrationsDirectory))
    .filter(file => file.endsWith(".sql"))
    .sort();
  for (const file of files)
    await engine.exec(
      await readFile(path.join(migrationsDirectory, file), "utf8")
    );

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
  // The anonymous public pool assumes the restricted aura_public role and never
  // binds a principal, exactly as production's separate public login would.
  const publicDb = new PgDatabase({ url, role: "aura_public", max: 4 });
  const admin = new PgDatabase({ url, max: 2 });
  serializeUnitsOfWork(db, publicDb, admin);
  return {
    url,
    db,
    publicDb,
    admin,
    async close() {
      await db.close();
      await publicDb.close();
      await admin.close();
      await server.stop();
      await engine.close();
    },
  };
}
