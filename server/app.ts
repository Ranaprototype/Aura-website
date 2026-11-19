import express from "express";
import path from "node:path";
import { diagnostics } from "./modules/diagnostics";
import type { DiagnosticsStore } from "./lib/supabase";
import { errors, fail } from "./http/errors";

export function createApp({
  store,
  diagnosticToken,
  staticPath,
}: {
  store?: DiagnosticsStore;
  diagnosticToken?: string;
  staticPath?: string;
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res
      .set("X-Content-Type-Options", "nosniff")
      .set("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(
    "/api",
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    diagnostics(store, diagnosticToken),
    (_req, res) => fail(res, 404, "not_found")
  );
  if (staticPath) {
    app.use(express.static(staticPath));
    app.get("*", (_req, res) =>
      res.sendFile(path.join(staticPath, "index.html"))
    );
  }
  app.use(errors);
  return app;
}
