import express from "express";
import path from "node:path";
import { isRetiredPath, isStorefrontPath } from "../shared/routes";
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
  app.use((req, res, next) =>
    isRetiredPath(req.path) ? fail(res, 410, "gone") : next()
  );
  if (staticPath) {
    app.use(express.static(staticPath));
    app.get("*", (req, res) =>
      isStorefrontPath(req.path)
        ? res.sendFile(path.join(staticPath, "index.html"))
        : fail(res, 404, "not_found")
    );
  }
  app.use(errors);
  return app;
}
