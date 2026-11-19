import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DiagnosticsStore } from "../lib/supabase";
import { fail } from "../http/errors";

const digest = (value: string) => createHash("sha256").update(value).digest();
const body = z.object({ message: z.string().trim().min(1).max(200) }).strict();
export function diagnostics(store?: DiagnosticsStore, token?: string) {
  const router = express.Router();
  router.get("/health/live", (_req, res) => res.json({ status: "alive" }));
  router.get(["/health", "/health/ready"], async (_req, res) => {
    try {
      if (!store) return fail(res, 503, "not_ready");
      await store.ready();
      return res.json({ status: "ready" });
    } catch {
      return fail(res, 503, "not_ready");
    }
  });
  router.use("/hello", (req, res, next) => {
    if (!store || !token) return fail(res, 404, "not_found");
    if (
      req.headers.origin ||
      !timingSafeEqual(
        digest(req.get("authorization") ?? ""),
        digest(`Bearer ${token}`)
      )
    )
      return fail(res, 403, "forbidden");
    next();
  });
  router.get("/hello", async (_req, res) => {
    try {
      return res.json({ data: await store!.recent() });
    } catch {
      return fail(res, 503, "database_unavailable");
    }
  });
  router.post(
    "/hello",
    (req, res, next) =>
      req.is("application/json")
        ? next()
        : fail(res, 415, "unsupported_media_type"),
    express.json({ limit: "4kb" }),
    async (req, res) => {
      const parsed = body.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_message");
      try {
        return res
          .status(201)
          .json({ data: await store!.add(parsed.data.message) });
      } catch {
        return fail(res, 503, "database_unavailable");
      }
    }
  );
  return router;
}
