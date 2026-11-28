/**
 * Phase 4 anonymous public storefront read router.
 *
 * Owner-approved D-01/D-02/D-22..D-25. Reads run on the SEPARATE public pool
 * (restricted `aura_public`, zero base-table grants) against the SECURITY
 * DEFINER discovery views. No session is required; attachSession/csrfGuard
 * tolerate anonymous GETs. The surface fails closed (503) when the public pool
 * is unconfigured and never falls back to the app pool. Every response is
 * `no-store`; a uniform 404 hides existence; the public limiter is isolated.
 */
import express, { type Request, type Response, type NextFunction } from "express";
import type { AppServices } from "../../services";
import type { Database } from "../../db/database";
import { fail, RequestError } from "../../http/errors";
import {
  DEFAULT_SORT,
  type PublicProductDetail,
  type PublicProductList,
  type PublicProductSummary,
} from "../../../shared/storefront";
import { InvalidCursor, signCursor, verifyCursor, type CursorBinding, type CursorKey } from "./cursor";
import { consumePublicRead } from "./limits";
import { parseListQuery, parseSlug, type ListQuery } from "./schemas";

interface ListRow {
  slug: string;
  title: string;
  summary: string | null;
  approved_at_text: string;
  category_slug: string;
  category_name: string;
  hero_image: string | null;
}

/** Build the keyset list query. Filters are re-applied server-side regardless
 * of the cursor; the cursor only carries the keyset position for the sort. */
function buildListQuery(query: ListQuery, key: CursorKey | null) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (query.category) {
    params.push(query.category);
    where.push(`p.category_slug = $${params.length}`);
  }
  if (query.q) {
    params.push(query.q);
    where.push(
      `to_tsvector('simple', p.title || ' ' || coalesce(p.summary, '')) @@ websearch_to_tsquery('simple', $${params.length})`
    );
  }
  for (const entry of query.attr) {
    const idx = entry.indexOf(":");
    params.push(entry.slice(0, idx), entry.slice(idx + 1));
    where.push(
      `exists (select 1 from aura.public_product_attributes a
                where a.product_slug = p.slug and a.key = $${params.length - 1}
                  and a.value = $${params.length})`
    );
  }
  if (key) {
    params.push(key[0], key[1]);
    where.push(
      query.sort === "newest"
        ? `(p.approved_at, p.slug) < ($${params.length - 1}::timestamptz, $${params.length})`
        : `(p.title, p.slug) > ($${params.length - 1}, $${params.length})`
    );
  }
  params.push(query.limit + 1); // one extra row to detect a next page
  const order =
    query.sort === "newest"
      ? "p.approved_at desc, p.slug desc"
      : "p.title asc, p.slug asc";
  const sql = `
    select p.slug, p.title, p.summary, p.approved_at::text as approved_at_text,
           p.category_slug, p.category_name,
           (select m.url from aura.public_product_media m
             where m.product_slug = p.slug order by m.position limit 1) as hero_image
      from aura.public_products p
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by ${order}
     limit $${params.length}`;
  return { sql, params };
}

const toSummary = (row: ListRow): PublicProductSummary => ({
  slug: row.slug,
  title: row.title,
  summary: row.summary,
  category: { slug: row.category_slug, name: row.category_name },
  approvedAt: new Date(row.approved_at_text).toISOString(),
  heroImage: row.hero_image,
});

const cursorKeyOf = (row: ListRow, sort: string): CursorKey =>
  sort === "newest" ? [row.approved_at_text, row.slug] : [row.title, row.slug];

async function loadDetail(db: Database, slug: string) {
  const live = await db.query<{
    slug: string;
    title: string;
    summary: string | null;
    description: string | null;
    approved_at: Date;
    category_slug: string;
    category_name: string;
  }>(
    `select slug, title, summary, description, approved_at, category_slug, category_name
       from aura.public_products where slug = $1`,
    [slug]
  );
  return live[0];
}

async function detailBody(db: Database, slug: string): Promise<PublicProductDetail | null> {
  let row = await loadDetail(db, slug);
  let redirectedFrom: string | undefined;
  if (!row) {
    // Live-first: only if no live product matches do we consult redirects.
    const redirect = await db.query<{ canonical_slug: string }>(
      `select canonical_slug from aura.public_slug_redirects where slug = $1`,
      [slug]
    );
    if (!redirect[0]) return null;
    row = await loadDetail(db, redirect[0].canonical_slug);
    if (!row) return null;
    redirectedFrom = slug;
  }
  const [variants, media, attributes] = await Promise.all([
    db.query<{
      title: string;
      size: string | null;
      colour: string | null;
      material: string | null;
      position: number;
    }>(
      `select title, size, colour, material, position
         from aura.public_product_variants where product_slug = $1 order by position`,
      [row.slug]
    ),
    db.query<{ kind: string; url: string; alt_text: string | null; position: number }>(
      `select kind, url, alt_text, position
         from aura.public_product_media where product_slug = $1 order by position`,
      [row.slug]
    ),
    db.query<{ key: string; label: string; value: string }>(
      `select key, label, value from aura.public_product_attributes
        where product_slug = $1 order by position`,
      [row.slug]
    ),
  ]);
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    category: { slug: row.category_slug, name: row.category_name },
    approvedAt: new Date(row.approved_at).toISOString(),
    variants,
    media: media.map(m => ({
      kind: "image" as const,
      url: m.url,
      altText: m.alt_text,
      position: m.position,
    })),
    attributes,
    ...(redirectedFrom ? { canonicalSlug: row.slug, redirectedFrom } : {}),
  };
}

/**
 * True when the public pool could not be reached (connection-class failures),
 * as opposed to a logic error. The storefront fails closed with 503 in that
 * case (plan §3.1: unconfigured OR unavailable); genuine bugs still surface as
 * 500 so they are not silently swallowed.
 */
function isPublicUnavailable(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (typeof code !== "string") return false;
  // SQLSTATE: 08xxx connection exception, 57P01/02/03 shutdown/cannot-connect,
  // 53300 too_many_connections.
  if (code.startsWith("08")) return true;
  if (code === "57P01" || code === "57P02" || code === "57P03" || code === "53300")
    return true;
  // Node network errors raised by the pg driver / pool.
  return [
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EPIPE",
  ].includes(code);
}

export function publicStorefrontRoutes(services: AppServices) {
  const router = express.Router();

  // Wrap an anonymous public handler: fail closed without a public pool, apply
  // the isolated per-IP limiter, and map errors to the uniform public envelope.
  const publicHandler =
    (handler: (db: Database, req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      const db = services.publicDb;
      if (!db) return fail(res, 503, "storefront_unavailable");
      try {
        const limit = await consumePublicRead(
          db,
          req.ip ?? "unknown",
          services.publicReadIpLimit,
          (event, fields) => services.logger.warn(event, fields)
        );
        if (!limit.allowed) {
          res.set("Retry-After", String(limit.retryAfter));
          return fail(res, 429, "rate_limited");
        }
        const body = await handler(db, req);
        res.set("Cache-Control", "no-store");
        return res.status(200).json(body);
      } catch (error) {
        if (error instanceof InvalidCursor) return fail(res, 400, "invalid_cursor");
        if (error instanceof RequestError) return fail(res, error.status, error.code);
        if (isPublicUnavailable(error)) return fail(res, 503, "storefront_unavailable");
        return next(error);
      }
    };

  router.get(
    "/storefront/products",
    publicHandler(async (db, req) => {
      const query = parseListQuery(req.query as Record<string, unknown>);
      const binding: CursorBinding = {
        route: "products",
        q: query.q,
        category: query.category,
        attr: query.attr,
        sort: query.sort,
        limit: query.limit,
      };
      const key = query.cursor
        ? verifyCursor(query.cursor, binding, services.publicCursorSecret)
        : null;
      const { sql, params } = buildListQuery(query, key);
      const rows = (await db.query<ListRow>(sql, params)) ?? [];
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const items = page.map(toSummary);
      const nextCursor =
        hasMore && page.length
          ? signCursor(binding, cursorKeyOf(page[page.length - 1]!, query.sort), services.publicCursorSecret)
          : null;
      return { items, nextCursor } satisfies PublicProductList;
    })
  );

  router.get(
    "/storefront/products/:slug",
    publicHandler(async (db, req) => {
      // A malformed slug is indistinguishable from a missing product: the
      // uniform 404 hides existence and reveals no validation difference.
      let slug: string;
      try {
        slug = parseSlug(req.params.slug);
      } catch {
        throw new RequestError(404, "not_found");
      }
      const body = await detailBody(db, slug);
      if (!body) throw new RequestError(404, "not_found");
      return body;
    })
  );

  return router;
}
