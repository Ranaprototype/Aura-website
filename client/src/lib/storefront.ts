/**
 * Phase 4 anonymous public discovery client. Same-origin relative GETs only;
 * no credentials are required (the double-submit cookie is tolerated). The
 * server re-derives every publication and allowlist rule — this module only
 * shapes requests and surfaces the returned discovery fields.
 */
import {
  DEFAULT_LIMIT,
  type PublicProductDetail,
  type PublicProductList,
  type StorefrontSort,
} from "../../../shared/storefront";

export interface DiscoveryQuery {
  q?: string;
  category?: string;
  /** Curated attribute filters as "key:value". */
  attr?: string[];
  sort?: StorefrontSort;
  limit?: number;
  cursor?: string | null;
}

export interface StorefrontResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function get<T>(path: string): Promise<StorefrontResult<T>> {
  const response = await fetch(`/api/v1/storefront${path}`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok ? (data as T) : undefined,
    error:
      !response.ok && data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : undefined,
  };
}

const queryString = (query: DiscoveryQuery): string => {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  for (const entry of query.attr ?? []) params.append("attr", entry);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit && query.limit !== DEFAULT_LIMIT)
    params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
};

export const storefront = {
  list: (query: DiscoveryQuery = {}) =>
    get<PublicProductList>(`/products${queryString(query)}`),
  detail: (slug: string) =>
    get<PublicProductDetail>(`/products/${encodeURIComponent(slug)}`),
};
