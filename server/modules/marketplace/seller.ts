import express from "express";
import { requireOrganization, requireRole } from "../authorized";
import { AccessError } from "../../db/database";
import { RequestError } from "../../http/errors";
import type { AppServices } from "../../services";
import { CATALOG_MANAGE_ROLES } from "../../../shared/marketplace";
import {
  countStatuses,
  loadAudit,
  loadSeller,
  loadSuspensionNote,
  requireSeller,
  serializeSeller,
  SELLER_COLUMNS,
} from "./helpers";
import { mapDatabaseError, sellerProfileBody } from "./schemas";

/**
 * Seller onboarding and dashboard routes.
 *
 * The organization comes from the verified membership resolved by
 * `requireOrganization`; no part of the request can name a different tenant.
 * Approval is a platform-administrator action and lives in the review module.
 */
export function sellerRoutes(services: AppServices) {
  const router = express.Router();

  router.get(
    "/seller/dashboard",
    requireOrganization(services, async ({ tx, orgId, role }) => {
      const seller = await loadSeller(tx, orgId!);
      // D-03: confidential suspension note is restricted to owner/admin here;
      // the accessor re-checks in the database.
      const suspensionNote =
        seller && (role === "owner" || role === "admin")
          ? await loadSuspensionNote(tx, orgId!)
          : undefined;
      const counts = await countStatuses(tx, orgId!);
      const recent = seller
        ? await loadAudit(tx, "seller_profile", seller.id)
        : [];
      const [organization] = await tx.query<{ name: string }>(
        `select name from aura.organizations where id = $1`,
        [orgId]
      );
      return {
        body: {
          organization: { id: orgId, name: organization?.name ?? "" },
          role,
          seller: seller ? serializeSeller(seller, suspensionNote) : null,
          productCounts: counts,
          recentSellerActivity: recent.slice(-10).reverse(),
          permissions: {
            canManage: role === "owner" || role === "admin",
            canWriteCatalogue: role !== "viewer",
          },
        },
      };
    })
  );

  router.get(
    "/seller/profile",
    requireOrganization(services, async ({ tx, orgId, role }) => {
      const seller = await loadSeller(tx, orgId!);
      const suspensionNote =
        seller && (role === "owner" || role === "admin")
          ? await loadSuspensionNote(tx, orgId!)
          : undefined;
      return {
        body: {
          seller: seller ? serializeSeller(seller, suspensionNote) : null,
          audit: seller ? await loadAudit(tx, "seller_profile", seller.id) : [],
        },
      };
    })
  );

  // Phase 4 (D-03): the confidential suspension note. Owner/admin of the org
  // or a platform administrator only; ordinary members get 403 role_forbidden.
  // The database accessor re-checks the same rule, so this guard is defence in
  // depth, not the sole gate.
  router.get(
    "/seller/suspension",
    requireOrganization(services, async ({ tx, orgId, role, auth }) => {
      const seller = await loadSeller(tx, orgId!);
      if (!seller) throw new RequestError(404, "seller_not_found");
      let allowed = role === "owner" || role === "admin";
      if (!allowed) {
        const admin = await tx.query(
          `select 1 from aura.platform_admins where principal_id = $1`,
          [auth.principalId]
        );
        allowed = admin.length > 0;
      }
      if (!allowed) throw new AccessError("role_forbidden");
      const note = await loadSuspensionNote(tx, orgId!);
      return {
        body: {
          suspendedAt: seller.suspended_at
            ? new Date(seller.suspended_at).toISOString()
            : null,
          note,
        },
      };
    })
  );

  router.put(
    "/seller/profile",
    requireRole(
      services,
      CATALOG_MANAGE_ROLES,
      async ({ tx, orgId, req, auth }) => {
        const parsed = sellerProfileBody.safeParse(req.body);
        if (!parsed.success) throw new RequestError(400, "invalid_request");
        const input = parsed.data;

        const existing = await loadSeller(tx, orgId!);
        try {
          if (!existing) {
            const rows = await tx.query(
              `insert into aura.seller_profiles
               (org_id, display_name, legal_name, business_email, country, website,
                description, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             returning ${SELLER_COLUMNS}`,
              [
                orgId,
                input.displayName,
                input.legalName,
                input.businessEmail,
                input.country,
                input.website ?? null,
                input.description ?? null,
                auth.principalId,
              ]
            );
            const seller = rows[0] as never;
            return {
              status: 201,
              body: { seller: serializeSeller(seller), audit: [] },
            };
          }

          if (existing.status === "submitted")
            throw new RequestError(409, "seller_locked");

          const rows = await tx.query(
            `update aura.seller_profiles
              set display_name = $2, legal_name = $3, business_email = $4,
                  country = $5, website = $6, description = $7
            where org_id = $1
            returning ${SELLER_COLUMNS}`,
            [
              orgId,
              input.displayName,
              input.legalName,
              input.businessEmail,
              input.country,
              input.website ?? null,
              input.description ?? null,
            ]
          );
          const seller = rows[0] as never;
          return {
            body: {
              seller: serializeSeller(seller),
              audit: await loadAudit(tx, "seller_profile", existing.id),
            },
          };
        } catch (error) {
          return mapDatabaseError(error);
        }
      }
    )
  );

  router.post(
    "/seller/profile/submit",
    requireRole(services, CATALOG_MANAGE_ROLES, async ({ tx, orgId }) => {
      const seller = await requireSeller(tx, orgId!);
      if (seller.status === "submitted")
        throw new RequestError(409, "seller_already_submitted");
      if (seller.status === "approved")
        throw new RequestError(409, "seller_already_approved");
      try {
        const rows = await tx.query(
          `update aura.seller_profiles set status = 'submitted'
            where org_id = $1 and status in ('draft', 'rejected')
            returning ${SELLER_COLUMNS}`,
          [orgId]
        );
        const updated = rows[0] as never;
        if (!updated) throw new RequestError(409, "seller_locked");
        return { body: { seller: serializeSeller(updated) } };
      } catch (error) {
        return mapDatabaseError(error);
      }
    })
  );

  return router;
}
