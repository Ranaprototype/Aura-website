import express from "express";
import path from "node:path";
import { isRetiredPath, isStorefrontPath } from "../shared/routes";
import { diagnostics } from "./modules/diagnostics";
import { authRoutes } from "./modules/auth";
import { attachSession, csrfGuard } from "./modules/authorized";
import { workspaceRoutes } from "./modules/workspace";
import { marketplaceRoutes } from "./modules/marketplace";
import type { DiagnosticsStore } from "./lib/supabase";
import type { AppServices } from "./services";
import { errors, fail } from "./http/errors";

export function createApp({
  store,
  diagnosticToken,
  staticPath,
  services,
}: {
  store?: DiagnosticsStore;
  diagnosticToken?: string;
  staticPath?: string;
  /** Phase 2 services. When absent the versioned API is not mounted at all. */
  services?: AppServices;
} = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res
      .set("X-Content-Type-Options", "nosniff")
      .set("Referrer-Policy", "no-referrer")
      .set("X-Frame-Options", "DENY");
    next();
  });
  if (services) {
    const origin = services.appOrigin;
    app.use("/api/v1", attachSession(services));
    // Origin allowlisting and the double-submit cookie apply to the whole
    // versioned API, not just the auth routes; per-route authorization then
    // verifies the session-bound token as well.
    app.use("/api/v1", csrfGuard(services));
    app.use(
      "/api/v1/auth",
      express.json({ limit: "16kb" }),
      authRoutes(services, { appOrigin: origin })
    );
    app.use(
      "/api/v1",
      express.json({ limit: "16kb" }),
      workspaceRoutes(services, { appOrigin: origin })
    );
    // Phase 3: seller onboarding, catalogue and platform review. Same session,
    // same tenancy, same CSRF and origin checks as every other versioned route.
    app.use(
      "/api/v1",
      express.json({ limit: "32kb" }),
      marketplaceRoutes(services)
    );
  }
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
