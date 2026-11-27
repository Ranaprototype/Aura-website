import express from "express";
import { authorized, requireOrganization, requireRole } from "../authorized";
import { RequestError } from "../../http/errors";
import type { AppServices } from "../../services";
import {
  CATALOG_MANAGE_ROLES,
  CATALOG_WRITE_ROLES,
} from "../../../shared/marketplace";
import {
  loadAttributeValues,
  loadAudit,
  loadCategories,
  loadMedia,
  loadProductRow,
  loadRevisions,
  loadSeller,
  loadVariants,
  requireEditable,
  summarizeProduct,
  PRODUCT_SELECT,
  type ProductRow,
} from "./helpers";
import {
  attributeValuesBody,
  listQuery,
  mapDatabaseError,
  mediaBody,
  mediaUpdateBody,
  productCreateBody,
  productUpdateBody,
  uuidField,
  variantBody,
  variantUpdateBody,
} from "./schemas";

const iso = (value: Date | null | undefined) =>
  value ? new Date(value).toISOString() : null;

const uuidParam = (value: string | undefined) => {
  const parsed = uuidField.safeParse(value);
  if (!parsed.success) throw new RequestError(400, "invalid_request");
  return parsed.data;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "product";

/**
 * Seller catalogue routes. Every query runs inside a transaction that has the
 * verified principal and the requested organization bound, so the tenant
 * boundary is enforced twice: by the composite foreign keys and by RLS.
 */
export function catalogRoutes(services: AppServices) {
  const router = express.Router();

  router.get(
    "/categories",
    authorized(services, {}, async ({ tx }) => ({
      body: { categories: await loadCategories(tx) },
    }))
  );

  router.get(
    "/seller/products",
    requireOrganization(services, async ({ tx, orgId, req }) => {
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) throw new RequestError(400, "invalid_request");
      const { status, limit } = parsed.data;
      if (
        status &&
        !["draft", "submitted", "approved", "rejected", "archived"].includes(
          status
        )
      )
        throw new RequestError(400, "invalid_status");
      const rows = await tx.query<ProductRow>(
        `${PRODUCT_SELECT}
          where p.org_id = $1 ${status ? "and p.status = $3" : ""}
          order by p.updated_at desc, p.id
          limit $2`,
        status ? [orgId, limit, status] : [orgId, limit]
      );
      return { body: { products: rows.map(summarizeProduct) } };
    })
  );

  router.post(
    "/seller/products",
    requireRole(
      services,
      CATALOG_WRITE_ROLES,
      async ({ tx, orgId, req, auth }) => {
        const parsed = productCreateBody.safeParse(req.body);
        if (!parsed.success) throw new RequestError(400, "invalid_request");
        const seller = await loadSeller(tx, orgId!);
        if (!seller) throw new RequestError(409, "seller_profile_required");
        if (seller.status !== "approved")
          throw new RequestError(409, "seller_not_approved");

        const categories = await tx.query<{ id: string }>(
          `select id from aura.categories where id = $1 and is_active`,
          [parsed.data.categoryId]
        );
        if (!categories[0]) throw new RequestError(400, "invalid_category");

        const slug =
          parsed.data.slug ??
          `${slugify(parsed.data.title)}-${Date.now().toString(36)}`;
        try {
          const rows = await tx.query<ProductRow>(
            `insert into aura.products
             (org_id, seller_profile_id, category_id, slug, title, summary, description, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id`,
            [
              orgId,
              seller.id,
              parsed.data.categoryId,
              slug,
              parsed.data.title,
              parsed.data.summary ?? null,
              parsed.data.description ?? null,
              auth.principalId,
            ]
          );
          const product = await loadProductRow(tx, rows[0]!.id);
          return {
            status: 201,
            body: { product: summarizeProduct(product), audit: [] },
          };
        } catch (error) {
          return mapDatabaseError(error);
        }
      }
    )
  );

  router.get(
    "/seller/products/:productId",
    requireOrganization(services, async ({ tx, req, role, orgId }) => {
      const productId = uuidParam(req.params.productId);
      const row = await loadProductRow(tx, productId, orgId);
      const canWrite = (CATALOG_WRITE_ROLES as readonly string[]).includes(
        role ?? ""
      );
      const canManage = (CATALOG_MANAGE_ROLES as readonly string[]).includes(
        role ?? ""
      );
      return {
        body: {
          product: {
            ...summarizeProduct(row),
            summary: row.summary,
            description: row.description,
            submittedAt: iso(row.submitted_at),
            approvedAt: iso(row.approved_at),
            archivedAt: iso(row.archived_at),
            seller: {
              id: row.seller_id,
              displayName: row.seller_display_name,
              status: row.seller_status,
            },
            variants: await loadVariants(tx, productId),
            media: await loadMedia(tx, productId),
            attributes: await loadAttributeValues(tx, productId),
            revisions: await loadRevisions(tx, productId, {
              withSnapshot: true,
            }),
            audit: await loadAudit(tx, "product", productId),
            permissions: {
              canEdit:
                canWrite &&
                ["draft", "rejected", "approved"].includes(row.status),
              canSubmit:
                canWrite &&
                row.seller_status === "approved" &&
                ["draft", "rejected", "approved"].includes(row.status),
              canArchive:
                canManage && !["submitted", "archived"].includes(row.status),
            },
          },
        },
      };
    })
  );

  router.patch(
    "/seller/products/:productId",
    requireRole(services, CATALOG_WRITE_ROLES, async ({ tx, req, orgId }) => {
      const productId = uuidParam(req.params.productId);
      const parsed = productUpdateBody.safeParse(req.body);
      if (!parsed.success) throw new RequestError(400, "invalid_request");
      const product = await loadProductRow(tx, productId, orgId);
      requireEditable(product.status);
      try {
        await tx.query(
          `update aura.products
              set title = coalesce($2, title),
                  summary = case when $3::boolean then $4 else summary end,
                  description = case when $5::boolean then $6 else description end
            where id = $1 and org_id = $7`,
          [
            productId,
            parsed.data.title ?? null,
            parsed.data.summary !== undefined,
            parsed.data.summary ?? null,
            parsed.data.description !== undefined,
            parsed.data.description ?? null,
            orgId,
          ]
        );
        const updated = await loadProductRow(tx, productId, orgId);
        return {
          body: {
            product: summarizeProduct(updated),
            audit: await loadAudit(tx, "product", productId),
          },
        };
      } catch (error) {
        return mapDatabaseError(error);
      }
    })
  );

  router.post(
    "/seller/products/:productId/submit",
    requireRole(
      services,
      CATALOG_WRITE_ROLES,
      async ({ tx, req, orgId, auth }) => {
        const productId = uuidParam(req.params.productId);
        const product = await loadProductRow(tx, productId, orgId);
        if (product.seller_status !== "approved")
          throw new RequestError(409, "seller_not_approved");
        if (product.status === "submitted")
          throw new RequestError(409, "product_already_submitted");
        if (product.status === "archived")
          throw new RequestError(409, "product_archived");

        const [readiness] = await tx.query<{
          variants: number;
          missing: number;
        }>(
          `select
           (select count(*)::int from aura.product_variants where product_id = $1) as variants,
           (select count(*)::int from aura.category_attributes a
             where a.category_id = $2 and a.is_required
               and not exists (select 1 from aura.product_attribute_values v
                                where v.product_id = $1 and v.attribute_id = a.id)) as missing`,
          [productId, product.category_id]
        );
        if (!readiness || readiness.variants < 1 || readiness.missing > 0) {
          throw new RequestError(400, "product_incomplete");
        }

        try {
          const revisions = await tx.query<{
            id: string;
            revision_number: number;
          }>(
            `insert into aura.product_revisions
             (product_id, org_id, revision_number, snapshot, submitted_by)
           values ($1, $2, 0, '{}'::jsonb, $3)
           returning id, revision_number`,
            [productId, orgId, auth.principalId]
          );
          await tx.query(
            `update aura.products set status = 'submitted', submitted_at = now()
            where id = $1 and org_id = $2`,
            [productId, orgId]
          );
          return {
            status: 201,
            body: {
              product: summarizeProduct(await loadProductRow(tx, productId, orgId)),
              revision: revisions[0],
              audit: await loadAudit(tx, "product", productId),
            },
          };
        } catch (error) {
          return mapDatabaseError(error);
        }
      }
    )
  );

  router.post(
    "/seller/products/:productId/archive",
    requireRole(services, CATALOG_MANAGE_ROLES, async ({ tx, req, orgId }) => {
      const productId = uuidParam(req.params.productId);
      const product = await loadProductRow(tx, productId, orgId);
      if (product.status === "archived")
        throw new RequestError(409, "product_archived");
      if (product.status === "submitted")
        throw new RequestError(409, "product_locked");
      try {
        await tx.query(
          `update aura.products set status = 'archived' where id = $1 and org_id = $2`,
          [productId, orgId]
        );
        return {
          body: {
            product: summarizeProduct(await loadProductRow(tx, productId, orgId)),
            audit: await loadAudit(tx, "product", productId),
          },
        };
      } catch (error) {
        return mapDatabaseError(error);
      }
    })
  );

  // -------------------------------------------------------------------------
  // Variants
  // -------------------------------------------------------------------------
  router.post(
    "/seller/products/:productId/variants",
    requireRole(
      services,
      CATALOG_WRITE_ROLES,
      async ({ tx, req, orgId, auth }) => {
        const productId = uuidParam(req.params.productId);
        const parsed = variantBody.safeParse(req.body);
        if (!parsed.success) throw new RequestError(400, "invalid_request");
        const product = await loadProductRow(tx, productId, orgId);
        requireEditable(product.status);
        try {
          const rows = await tx.query<{ id: string }>(
            `insert into aura.product_variants
             (org_id, product_id, sku, title, size, colour, material, position, created_by)
           values ($1, $2, $3, $4, $5, $6, $7,
                   coalesce($8, (select coalesce(max(position), 0) + 1
                                   from aura.product_variants where product_id = $2)),
                   $9)
           returning id`,
            [
              orgId,
              productId,
              parsed.data.sku,
              parsed.data.title,
              parsed.data.size ?? null,
              parsed.data.colour ?? null,
              parsed.data.material ?? null,
              parsed.data.position ?? null,
              auth.principalId,
            ]
          );
          return {
            status: 201,
            body: {
              variants: await loadVariants(tx, productId),
              id: rows[0]!.id,
            },
          };
        } catch (error) {
          return mapDatabaseError(error);
        }
      }
    )
  );

  router.patch(
    "/seller/products/:productId/variants/:variantId",
    requireRole(services, CATALOG_WRITE_ROLES, async ({ tx, req, orgId }) => {
      const productId = uuidParam(req.params.productId);
      const variantId = uuidParam(req.params.variantId);
      const parsed = variantUpdateBody.safeParse(req.body);
      if (!parsed.success || Object.keys(parsed.data).length === 0)
        throw new RequestError(400, "invalid_request");
      const product = await loadProductRow(tx, productId, orgId);
      requireEditable(product.status);
      try {
        const rows = await tx.query<{ id: string }>(
          `update aura.product_variants
              set sku = coalesce($3, sku),
                  title = coalesce($4, title),
                  size = case when $5::boolean then $6 else size end,
                  colour = case when $7::boolean then $8 else colour end,
                  material = case when $9::boolean then $10 else material end,
                  position = coalesce($11, position)
            where id = $2 and product_id = $1 and org_id = $12
            returning id`,
          [
            productId,
            variantId,
            parsed.data.sku ?? null,
            parsed.data.title ?? null,
            parsed.data.size !== undefined,
            parsed.data.size ?? null,
            parsed.data.colour !== undefined,
            parsed.data.colour ?? null,
            parsed.data.material !== undefined,
            parsed.data.material ?? null,
            parsed.data.position ?? null,
            orgId,
          ]
        );
        if (!rows[0]) throw new RequestError(404, "variant_not_found");
        return { body: { variants: await loadVariants(tx, productId) } };
      } catch (error) {
        return mapDatabaseError(error);
      }
    })
  );

  router.delete(
    "/seller/products/:productId/variants/:variantId",
    requireRole(services, CATALOG_WRITE_ROLES, async ({ tx, req, orgId }) => {
      const productId = uuidParam(req.params.productId);
      const variantId = uuidParam(req.params.variantId);
      const product = await loadProductRow(tx, productId, orgId);
      requireEditable(product.status);
      const rows = await tx.query<{ id: string }>(
        `delete from aura.product_variants where id = $1 and product_id = $2 returning id`,
        [variantId, productId]
      );
      if (!rows[0]) throw new RequestError(404, "variant_not_found");
      return { body: { variants: await loadVariants(tx, productId) } };
    })
  );

  // -------------------------------------------------------------------------
  // Media references (external https URLs only; no upload or storage path)
  // -------------------------------------------------------------------------
  router.post(
    "/seller/products/:productId/media",
    requireRole(
      services,
      CATALOG_WRITE_ROLES,
      async ({ tx, req, orgId, auth }) => {
        const productId = uuidParam(req.params.productId);
        const parsed = mediaBody.safeParse(req.body);
        if (!parsed.success) throw new RequestError(400, "invalid_request");
        if (parsed.data.kind === "image" && !hasImageExtension(parsed.data.url))
          throw new RequestError(400, "invalid_media_url");
        const product = await loadProductRow(tx, productId, orgId);
        requireEditable(product.status);
        const rows = await tx.query<{ id: string }>(
          `insert into aura.product_media
           (org_id, product_id, kind, url, alt_text, position, created_by)
         values ($1, $2, $3, $4, $5,
                 coalesce($6, (select coalesce(max(position), 0) + 1
                                from aura.product_media where product_id = $2)),
                 $7)
         returning id`,
          [
            orgId,
            productId,
            parsed.data.kind,
            parsed.data.url,
            parsed.data.altText ?? null,
            parsed.data.position ?? null,
            auth.principalId,
          ]
        );
        return {
          status: 201,
          body: { media: await loadMedia(tx, productId), id: rows[0]!.id },
        };
      }
    )
  );

  router.patch(
    "/seller/products/:productId/media/:mediaId",
    requireRole(services, CATALOG_WRITE_ROLES, async ({ tx, req, orgId }) => {
      const productId = uuidParam(req.params.productId);
      const mediaId = uuidParam(req.params.mediaId);
      const parsed = mediaUpdateBody.safeParse(req.body);
      if (!parsed.success || Object.keys(parsed.data).length === 0)
        throw new RequestError(400, "invalid_request");
      if (
        parsed.data.url &&
        parsed.data.kind !== "reference" &&
        !hasImageExtension(parsed.data.url)
      )
        throw new RequestError(400, "invalid_media_url");
      const product = await loadProductRow(tx, productId, orgId);
      requireEditable(product.status);
      const rows = await tx.query<{ id: string }>(
        `update aura.product_media
            set kind = coalesce($3, kind),
                url = coalesce($4, url),
                alt_text = case when $5::boolean then $6 else alt_text end,
                position = coalesce($7, position)
          where id = $2 and product_id = $1 and org_id = $8
          returning id`,
        [
          productId,
          mediaId,
          parsed.data.kind ?? null,
          parsed.data.url ?? null,
          parsed.data.altText !== undefined,
          parsed.data.altText ?? null,
          parsed.data.position ?? null,
          orgId,
        ]
      );
      if (!rows[0]) throw new RequestError(404, "media_not_found");
      return { body: { media: await loadMedia(tx, productId) } };
    })
  );

  router.delete(
    "/seller/products/:productId/media/:mediaId",
    requireRole(services, CATALOG_WRITE_ROLES, async ({ tx, req, orgId }) => {
      const productId = uuidParam(req.params.productId);
      const mediaId = uuidParam(req.params.mediaId);
      const product = await loadProductRow(tx, productId, orgId);
      requireEditable(product.status);
      const rows = await tx.query<{ id: string }>(
        `delete from aura.product_media
          where id = $1 and product_id = $2 and org_id = $3 returning id`,
        [mediaId, productId, orgId]
      );
      if (!rows[0]) throw new RequestError(404, "media_not_found");
      return { body: { media: await loadMedia(tx, productId) } };
    })
  );

  // -------------------------------------------------------------------------
  // Category attribute values (validated against the category definition)
  // -------------------------------------------------------------------------
  router.put(
    "/seller/products/:productId/attributes",
    requireRole(services, CATALOG_WRITE_ROLES, async ({ tx, req, orgId }) => {
      const productId = uuidParam(req.params.productId);
      const parsed = attributeValuesBody.safeParse(req.body);
      if (!parsed.success) throw new RequestError(400, "invalid_request");
      const product = await loadProductRow(tx, productId, orgId);
      requireEditable(product.status);

      const definitions = await tx.query<{
        id: string;
        data_type: string;
        options: string[] | null;
      }>(
        `select id, data_type, options from aura.category_attributes where category_id = $1`,
        [product.category_id]
      );
      const byId = new Map(definitions.map(row => [row.id, row]));
      const seen = new Set<string>();
      for (const entry of parsed.data.values) {
        const definition = byId.get(entry.attributeId);
        if (!definition)
          throw new RequestError(400, "attribute_not_in_category");
        if (seen.has(entry.attributeId))
          throw new RequestError(400, "duplicate_attribute");
        seen.add(entry.attributeId);
        if (
          definition.data_type === "select" &&
          !definition.options?.includes(entry.value)
        )
          throw new RequestError(400, "invalid_attribute_value");
        if (
          definition.data_type === "number" &&
          !/^-?[0-9]{1,12}(\.[0-9]{1,6})?$/.test(entry.value)
        )
          throw new RequestError(400, "invalid_attribute_value");
        if (
          definition.data_type === "boolean" &&
          !["true", "false"].includes(entry.value)
        )
          throw new RequestError(400, "invalid_attribute_value");
      }

      try {
        await tx.query(
          `delete from aura.product_attribute_values
            where product_id = $1 and org_id = $2`,
          [productId, orgId]
        );
        for (const entry of parsed.data.values) {
          await tx.query(
            `insert into aura.product_attribute_values
               (org_id, product_id, attribute_id, value)
             values ($1, $2, $3, $4)`,
            [orgId, productId, entry.attributeId, entry.value]
          );
        }
        return {
          body: { attributes: await loadAttributeValues(tx, productId) },
        };
      } catch (error) {
        return mapDatabaseError(error);
      }
    })
  );

  return router;
}

/** Media references point at an owned external asset; uploads are out of scope. */
const hasImageExtension = (value: string) =>
  /\.(?:png|jpe?g|webp|avif|gif)(?:\?[^#]*)?$/i.test(value);
