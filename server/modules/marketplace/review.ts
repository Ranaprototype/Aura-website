import express from "express";
import { requirePlatformAdmin } from "../authorized";
import { RequestError } from "../../http/errors";
import type { AppServices } from "../../services";
import {
  isPurchasable,
  SELLER_STATUSES,
  type SellerStatus,
} from "../../../shared/marketplace";
import {
  loadAttributeValues,
  loadAudit,
  loadMedia,
  loadProductRow,
  loadRevisions,
  loadSeller,
  loadVariants,
  serializeSeller,
  summarizeProduct,
  type ProductRow,
  type SellerRow,
  PRODUCT_SELECT,
  SELLER_COLUMNS,
} from "./helpers";
import {
  mapDatabaseError,
  optionalReviewNoteBody,
  reviewNoteBody,
  uuidField,
} from "./schemas";

const uuidParam = (value: string | undefined) => {
  const parsed = uuidField.safeParse(value);
  if (!parsed.success) throw new RequestError(400, "invalid_request");
  return parsed.data;
};

const iso = (value: Date | null | undefined) =>
  value ? new Date(value).toISOString() : null;

const adminSummary = (row: ProductRow) => ({
  ...summarizeProduct(row),
  orgName: row.org_name,
});

/**
 * Platform review routes.
 *
 * A platform administrator is not a tenant member: these routes never bind an
 * organization and never accept one from the browser for authorization. Row
 * visibility comes from the database where-clause `aura.is_platform_admin()`,
 * and the lifecycle transitions re-check the same grant inside the triggers.
 */
export function reviewRoutes(services: AppServices) {
  const router = express.Router();

  router.get(
    "/admin/sellers",
    requirePlatformAdmin(services, async ({ tx, req }) => {
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      if (status && !SELLER_STATUSES.includes(status as SellerStatus))
        throw new RequestError(400, "invalid_status");
      const rows = await tx.query<SellerRow & { org_name: string }>(
        `select sp.id, sp.org_id, sp.display_name, sp.legal_name, sp.business_email,
                sp.country, sp.website, sp.description, sp.status, sp.submitted_at,
                sp.reviewed_at, sp.review_note, sp.created_at, sp.updated_at,
                o.name as org_name
           from aura.seller_profiles sp
           join aura.organizations o on o.id = sp.org_id
          ${status ? "where sp.status = $1" : ""}
          order by sp.submitted_at desc nulls last, sp.created_at desc
          limit 100`,
        status ? [status] : []
      );
      return {
        body: {
          sellers: rows.map(row => ({
            ...serializeSeller(row),
            orgName: row.org_name,
          })),
        },
      };
    })
  );

  router.get(
    "/admin/sellers/:orgId",
    requirePlatformAdmin(services, async ({ tx, req }) => {
      const orgId = uuidParam(req.params.orgId);
      const rows = await tx.query<{ name: string }>(
        `select name from aura.organizations where id = $1`,
        [orgId]
      );
      if (!rows[0]) throw new RequestError(404, "organization_not_found");
      const seller = await loadSeller(tx, orgId);
      if (!seller) throw new RequestError(404, "seller_not_found");
      const products = await tx.query<ProductRow>(
        `${PRODUCT_SELECT} where p.org_id = $1 order by p.updated_at desc limit 50`,
        [orgId]
      );
      return {
        body: {
          organization: { id: orgId, name: rows[0].name },
          seller: serializeSeller(seller),
          audit: await loadAudit(tx, "seller_profile", seller.id),
          products: products.map(summarizeProduct),
        },
      };
    })
  );

  router.post(
    "/admin/sellers/:orgId/approve",
    requirePlatformAdmin(services, async ({ tx, req }) => {
      const orgId = uuidParam(req.params.orgId);
      await loadSellerOr404(tx, orgId);
      try {
        const rows = await tx.query<SellerRow>(
          `update aura.seller_profiles set status = 'approved'
            where org_id = $1 and status = 'submitted'
            returning ${SELLER_COLUMNS}`,
          [orgId]
        );
        if (!rows[0]) throw new RequestError(409, "invalid_status_transition");
        return {
          body: {
            seller: serializeSeller(rows[0]!),
            audit: await loadAudit(tx, "seller_profile", rows[0]!.id),
          },
        };
      } catch (error) {
        return mapDatabaseError(error);
      }
    })
  );

  router.post(
    "/admin/sellers/:orgId/reject",
    requirePlatformAdmin(services, async ({ tx, req }) => {
      const orgId = uuidParam(req.params.orgId);
      const parsed = reviewNoteBody.safeParse(req.body);
      if (!parsed.success) throw new RequestError(400, "invalid_request");
      await loadSellerOr404(tx, orgId);
      try {
        const rows = await tx.query<SellerRow>(
          `update aura.seller_profiles
              set status = 'rejected', review_note = $2
            where org_id = $1 and status = 'submitted'
            returning ${SELLER_COLUMNS}`,
          [orgId, parsed.data.note]
        );
        if (!rows[0]) throw new RequestError(409, "invalid_status_transition");
        return {
          body: {
            seller: serializeSeller(rows[0]!),
            audit: await loadAudit(tx, "seller_profile", rows[0]!.id),
          },
        };
      } catch (error) {
        return mapDatabaseError(error);
      }
    })
  );

  router.get(
    "/admin/products",
    requirePlatformAdmin(services, async ({ tx, req }) => {
      const status =
        typeof req.query.status === "string" ? req.query.status : "submitted";
      if (
        !["draft", "submitted", "approved", "rejected", "archived"].includes(
          status
        )
      )
        throw new RequestError(400, "invalid_status");
      const rows = await tx.query<ProductRow>(
        `${PRODUCT_SELECT}
          where p.status = $1
          order by p.submitted_at desc nulls last, p.updated_at desc
          limit 100`,
        [status]
      );
      return { body: { products: rows.map(adminSummary) } };
    })
  );

  router.get(
    "/admin/products/:productId",
    requirePlatformAdmin(services, async ({ tx, req }) => {
      const productId = uuidParam(req.params.productId);
      const row = await loadProductRow(tx, productId);
      const pending = await tx.query<{ id: string; revision_number: number }>(
        `select id, revision_number from aura.product_revisions
          where product_id = $1 and decision = 'pending'
          order by revision_number desc limit 1`,
        [productId]
      );
      return {
        body: {
          product: {
            ...adminSummary(row),
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
            purchasable: isPurchasable({
              status: row.status,
              pendingChanges: row.pending_changes,
              approvedRevisionId: row.approved_revision_id,
              sellerStatus: row.seller_status,
            }),
            variants: await loadVariants(tx, productId),
            media: await loadMedia(tx, productId),
            attributes: await loadAttributeValues(tx, productId),
            revisions: await loadRevisions(tx, productId, {
              withSnapshot: true,
            }),
            audit: await loadAudit(tx, "product", productId),
            pendingRevision: pending[0] ?? null,
          },
        },
      };
    })
  );

  router.post(
    "/admin/products/:productId/approve",
    requirePlatformAdmin(services, async ({ tx, req }) => {
      const productId = uuidParam(req.params.productId);
      const parsed = optionalReviewNoteBody.safeParse(req.body ?? {});
      if (!parsed.success) throw new RequestError(400, "invalid_request");
      return decide(
        services,
        tx,
        productId,
        "approved",
        parsed.data.note ?? null
      );
    })
  );

  router.post(
    "/admin/products/:productId/reject",
    requirePlatformAdmin(services, async ({ tx, req }) => {
      const productId = uuidParam(req.params.productId);
      const parsed = reviewNoteBody.safeParse(req.body);
      if (!parsed.success) throw new RequestError(400, "invalid_request");
      return decide(services, tx, productId, "rejected", parsed.data.note);
    })
  );

  /**
   * Decides the pending revision and the product state in one transaction, in
   * that order: the revision trigger refuses a decision on a product that is
   * not under review, and the product trigger refuses an approval whose
   * revision was not approved.
   */
  const decide = async (
    _services: AppServices,
    tx: Parameters<typeof loadProductRow>[0],
    productId: string,
    decision: "approved" | "rejected",
    note: string | null
  ) => {
    const locked = await tx.query<{ id: string; status: string }>(
      `select id, status from aura.products where id = $1 for update`,
      [productId]
    );
    if (!locked[0]) throw new RequestError(404, "product_not_found");
    if (locked[0].status !== "submitted")
      throw new RequestError(409, "invalid_status_transition");
    const pending = await tx.query<{ id: string }>(
      `select id from aura.product_revisions
        where product_id = $1 and decision = 'pending'
        order by revision_number desc limit 1`,
      [productId]
    );
    if (!pending[0]) throw new RequestError(409, "revision_required");

    try {
      await tx.query(
        `update aura.product_revisions
            set decision = $2, review_note = $3
          where id = $1 and decision = 'pending'`,
        [pending[0].id, decision, note]
      );
      if (decision === "approved") {
        await tx.query(
          `update aura.products
              set status = 'approved', approved_revision_id = $2,
                  approved_at = now(), pending_changes = false
            where id = $1`,
          [productId, pending[0].id]
        );
      } else {
        await tx.query(
          `update aura.products set status = 'rejected' where id = $1`,
          [productId]
        );
      }
    } catch (error) {
      return mapDatabaseError(error);
    }

    const row = await loadProductRow(tx, productId);
    return {
      body: {
        product: {
          ...adminSummary(row),
          revisions: await loadRevisions(tx, productId, { withSnapshot: true }),
          audit: await loadAudit(tx, "product", productId),
        },
      },
    };
  };

  return router;
}

const loadSellerOr404 = async (
  tx: Parameters<typeof loadSeller>[0],
  orgId: string
) => {
  const seller = await loadSeller(tx, orgId);
  if (!seller) throw new RequestError(404, "seller_not_found");
  return seller;
};
