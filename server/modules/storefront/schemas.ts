/**
 * Phase 4 public storefront request parsing. Every filter is re-applied
 * server-side; the cursor only carries a keyset position and is bound to the
 * exact request (see cursor.ts). Attribute filters are restricted to the
 * curated facet set (owner-approved D-25).
 */
import { z } from "zod";
import {
  DEFAULT_LIMIT,
  DEFAULT_SORT,
  FACET_KEYS,
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  STOREFRONT_SORTS,
} from "../../../shared/storefront";
import { RequestError } from "../../http/errors";

const slugField = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export interface ListQuery {
  q: string;
  category: string;
  attr: string[];
  sort: (typeof STOREFRONT_SORTS)[number];
  limit: number;
  cursor?: string;
}

const asArray = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
};

/** Parse + validate the public list query. Throws RequestError(400). */
export function parseListQuery(query: Record<string, unknown>): ListQuery {
  const qRaw = query.q;
  if (qRaw !== undefined && typeof qRaw !== "string")
    throw new RequestError(400, "invalid_request");
  const q = (qRaw ?? "").trim();
  if (q.length > MAX_QUERY_LENGTH) throw new RequestError(400, "invalid_request");

  const categoryRaw = query.category;
  if (categoryRaw !== undefined && typeof categoryRaw !== "string")
    throw new RequestError(400, "invalid_request");
  const category = categoryRaw ?? "";
  if (category && !slugField.safeParse(category).success)
    throw new RequestError(400, "invalid_request");

  // Curated attribute facets only (D-25). Each entry is "key:value".
  const attr: string[] = [];
  for (const entry of asArray(query.attr)) {
    const idx = entry.indexOf(":");
    if (idx <= 0 || idx === entry.length - 1)
      throw new RequestError(400, "invalid_request");
    const key = entry.slice(0, idx);
    const value = entry.slice(idx + 1);
    if (!FACET_KEYS.includes(key)) throw new RequestError(400, "invalid_request");
    if (value.length === 0 || value.length > 120)
      throw new RequestError(400, "invalid_request");
    attr.push(`${key}:${value}`);
  }
  if (attr.length > 8) throw new RequestError(400, "invalid_request");

  const sortRaw = query.sort === undefined ? DEFAULT_SORT : query.sort;
  if (typeof sortRaw !== "string" || !STOREFRONT_SORTS.includes(sortRaw as never))
    throw new RequestError(400, "invalid_request");
  const sort = sortRaw as (typeof STOREFRONT_SORTS)[number];

  const limitRaw = query.limit === undefined ? DEFAULT_LIMIT : query.limit;
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new RequestError(400, "invalid_request");

  const cursor = query.cursor;
  if (cursor !== undefined && typeof cursor !== "string")
    throw new RequestError(400, "invalid_request");

  return { q, category, attr, sort, limit, cursor };
}

/** Parse a public detail slug path parameter. */
export function parseSlug(value: string | undefined): string {
  const parsed = slugField.safeParse(value);
  if (!parsed.success) throw new RequestError(400, "invalid_request");
  return parsed.data;
}
