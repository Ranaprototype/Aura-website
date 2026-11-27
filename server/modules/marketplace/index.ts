import express from "express";
import type { AppServices } from "../../services";
import { catalogRoutes } from "./catalog";
import { reviewRoutes } from "./review";
import { sellerRoutes } from "./seller";

/**
 * Marketplace module: one router for seller onboarding, the seller catalogue
 * and platform review. It stays inside the modular monolith and shares the
 * Phase 2 identity, tenancy and email infrastructure rather than duplicating it.
 */
export function marketplaceRoutes(services: AppServices) {
  const router = express.Router();
  router.use(sellerRoutes(services));
  router.use(catalogRoutes(services));
  router.use(reviewRoutes(services));
  return router;
}
