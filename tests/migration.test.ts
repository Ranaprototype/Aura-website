import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

// Fresh embedded PostgreSQL, no URL, disk, credentials or target-side operations.
it("replays the historical migration and distinguishes grants from permissive RLS", async () => {
  const db = new PGlite();
  try {
    const sql = await readFile(
      new URL("../supabase/migrations/0001_hello.sql", import.meta.url),
      "utf8"
    );
    await db.exec(sql);
    await db.exec(
      "insert into public.hello(message) values ('isolated fixture')"
    );
    await db.exec(sql);
    expect(
      (
        await db.query(
          "select relrowsecurity from pg_class where oid='public.hello'::regclass"
        )
      ).rows
    ).toEqual([{ relrowsecurity: true }]);
    await db.exec("create role audit_reader; set role audit_reader");
    await expect(db.query("select id from public.hello")).rejects.toThrow(
      /permission denied/i
    );
    await db.exec(
      "reset role; grant select,insert on public.hello to audit_reader; set role audit_reader"
    );
    expect((await db.query("select message from public.hello")).rows).toEqual([
      { message: "isolated fixture" },
    ]);
    await db.exec(
      "insert into public.hello(message) values ('second fixture')"
    );
    await expect(db.exec("delete from public.hello")).rejects.toThrow(
      /permission denied/i
    );
  } finally {
    await db.close();
  }
}, 20000);
