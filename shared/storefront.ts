/**
 * Phase 4 public storefront contract shared by the API and the client.
 *
 * Owner-approved decisions (2026-11-27): D-22 implementation authorized;
 * D-23 title+summary word search; D-24 newest default + title A–Z; D-25 category
 * filters + CURATED product-attribute filters. D-01/D-02 keep anonymous access
 * to the minimum slug-keyed discovery allowlist (no internal ids, no seller
 * identity). These are plain types + constants: no authorization decision lives
 * here; the server re-derives every rule from the database.
 */

export const STOREFRONT_SORTS = ["newest", "title"] as const;
export type StorefrontSort = (typeof STOREFRONT_SORTS)[number];
export const DEFAULT_SORT: StorefrontSort = "newest";
export const DEFAULT_LIMIT = 24;
export const MAX_LIMIT = 60;
export const MAX_QUERY_LENGTH = 100;

/**
 * Category chips. Mirrors the platform-owned reference taxonomy seeded in
 * 0006 (read-only to the app). Maintained alongside the taxonomy; D-15 governs
 * any future expansion. Slugs are the public filter keys.
 */
export const STOREFRONT_CATEGORIES = [
  { slug: "sneakers", name: "Sneakers" },
  { slug: "apparel", name: "Apparel" },
  { slug: "accessories", name: "Accessories" },
] as const;

/**
 * Curated attribute facets (D-25). A curated subset of the seeded select-type
 * reference attributes — the material/construction family shoppers filter by.
 * Subjective `fit` and numeric `length` are intentionally excluded. Each key is
 * a public filter key; options are the bounded reference values. The server
 * rejects any attribute filter whose key is not in this curated set.
 */
export const STOREFRONT_FACETS = [
  {
    key: "upper-material",
    label: "Upper material",
    categorySlug: "sneakers",
    options: ["knit", "leather", "mesh", "recycled-textile"],
  },
  {
    key: "sole-type",
    label: "Sole type",
    categorySlug: "sneakers",
    options: ["foam", "carbon-plate", "rubber"],
  },
  {
    key: "fabric",
    label: "Fabric",
    categorySlug: "apparel",
    options: ["organic-cotton", "technical-knit", "recycled-polyester"],
  },
  {
    key: "material",
    label: "Material",
    categorySlug: "accessories",
    options: ["recycled-nylon", "leather-alternative", "aluminium"],
  },
] as const;

export const FACET_KEYS: readonly string[] = STOREFRONT_FACETS.map(f => f.key);

/** Public list item — the D-02 minimum discovery allowlist, slug-keyed. */
export interface PublicProductSummary {
  slug: string;
  title: string;
  summary: string | null;
  category: { slug: string; name: string };
  approvedAt: string;
  heroImage: string | null;
}

export interface PublicProductList {
  items: PublicProductSummary[];
  nextCursor: string | null;
}

export interface PublicVariant {
  title: string;
  size: string | null;
  colour: string | null;
  material: string | null;
  position: number;
}

export interface PublicMedia {
  kind: "image";
  url: string;
  altText: string | null;
  position: number;
}

export interface PublicAttribute {
  key: string;
  label: string;
  value: string;
}

export interface PublicProductDetail {
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  category: { slug: string; name: string };
  approvedAt: string;
  variants: PublicVariant[];
  media: PublicMedia[];
  attributes: PublicAttribute[];
  /** Present when the requested slug was a redirect to a live product. */
  canonicalSlug?: string;
  redirectedFrom?: string;
}
