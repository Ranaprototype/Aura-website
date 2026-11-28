/**
 * Phase 4 storefront module: the anonymous public read router. It stays inside
 * the modular monolith and reads only through the restricted public pool and
 * the SECURITY DEFINER discovery views. Admin suspension lives in the existing
 * marketplace review module (reuses requirePlatformAdmin + four-eyes).
 */
export { publicStorefrontRoutes } from "./public";
