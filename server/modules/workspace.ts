import express from "express";
import { z } from "zod";
import { AccessError } from "../db/database";
import { fail, RequestError } from "../http/errors";
import { hashToken, newToken } from "../auth/tokens";
import { normalizeRecipient, type EmailTemplateName } from "../email/templates";
import {
  authorized,
  getAuth,
  requireOrganization,
  requirePlatformAdmin,
  requireRole,
} from "./authorized";
import { uniqueSlug } from "./auth";
import type { AppServices } from "../services";

const roleField = z.enum(["owner", "admin", "member", "viewer"]);
const invitableRole = z.enum(["admin", "member", "viewer"]);

const uuidField = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const nameField = z.string().trim().min(1).max(120);

export function workspaceRoutes(services: AppServices, options: { appOrigin: string }) {
  const router = express.Router();

  const send = async (input: {
    template: EmailTemplateName;
    to: unknown;
    data: unknown;
    idempotencyKey: string;
  }) => {
    if (!services.email) return;
    try {
      await services.email.send(input);
    } catch {
      services.logger.error("email_dispatch_error", { template: input.template });
    }
  };

  // Organizations the caller belongs to.
  router.get(
    "/organizations",
    authorized(services, { verifiedEmail: false }, async ({ auth, tx }) => ({
      body: { organizations: await services.auth.memberships(auth.principalId, tx) },
    }))
  );

  router.post(
    "/organizations",
    authorized(services, {}, async ({ tx, auth, req }) => {
      const parsed = z
        .object({ name: nameField, slug: z.string().trim().max(64).optional() })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) throw new RequestError(400, "invalid_request");
      const slug = parsed.data.slug
        ? parsed.data.slug.toLowerCase()
        : uniqueSlug(parsed.data.name);
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))
        throw new RequestError(400, "invalid_slug");
      const rows = await tx.query<{ id: string; name: string; slug: string }>(
        `select (aura.create_organization($1, $2)).*`,
        [parsed.data.name, slug]
      );
      return {
        status: 201,
        body: {
          organization: rows[0],
          organizations: await services.auth.memberships(auth.principalId, tx),
        },
      };
    })
  );

  router.get(
    "/organizations/:orgId/members",
    requireRole(services, ["owner", "admin"], async ({ tx, orgId }) => ({
      body: {
        members: await tx.query(
          `select principal_id as "principalId", email, display_name as "displayName",
                  role, status, created_at as "createdAt"
             from aura.org_members($1)`,
          [orgId]
        ),
      },
    }))
  );

  router.patch(
    "/organizations/:orgId/members/:principalId",
    authorized(
      services,
      { organization: true, roles: ["owner", "admin"] },
      async ({ tx, orgId, req, auth }) => {
        const role = roleField.safeParse((req.body as { role?: unknown })?.role);
        const target = uuidField.safeParse(req.params.principalId);
        if (!role.success || !target.success)
          throw new RequestError(400, "invalid_request");
        const previous = await tx.query<{ role: string; email: string }>(
          `select role, email from aura.org_members($1) where principal_id = $2`,
          [orgId, target.data]
        );
        let rows: Array<{ principal_id: string; role: string }>;
        try {
          rows = await tx.query<{ principal_id: string; role: string }>(
            `select principal_id, role from aura.set_member_role($1, $2, $3)`,
            [orgId, target.data, role.data]
          );
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "42501") throw new AccessError("role_forbidden");
          if (code === "23514") throw new RequestError(409, "last_owner");
          if (code === "P0002") throw new RequestError(404, "membership_not_found");
          throw error;
        }
        const org = await tx.query<{ name: string }>(
          `select name from aura.organizations where id = $1`,
          [orgId]
        );
        const recipient = previous[0]?.email;
        const previousRole = previous[0]?.role;
        return {
          body: { membership: rows[0] },
          after:
            recipient && previousRole && previousRole !== role.data
              ? () =>
                  send({
                    template: "role-changed",
                    to: recipient,
                    idempotencyKey: `role-changed:${orgId}:${target.data}:${role.data}:${Date.now()}`,
                    data: {
                      orgName: org[0]?.name ?? "your organization",
                      previousRole,
                      newRole: role.data,
                      actorName: auth.displayName ?? auth.email,
                      appUrl: options.appOrigin,
                    },
                  })
              : undefined,
        };
      }
    )
  );

  router.delete(
    "/organizations/:orgId/members/:principalId",
    authorized(services, { organization: true, roles: ["owner", "admin"] }, async ({ tx, orgId, req, auth }) => {
      const target = uuidField.safeParse(req.params.principalId);
      if (!target.success) throw new RequestError(400, "invalid_request");
      const previous = await tx.query<{ email: string; displayName: string | null; role: string }>(
        `select email, display_name as "displayName", role from aura.org_members($1)
          where principal_id = $2`,
        [orgId, target.data]
      );
      let rows: Array<{ principal_id: string; role: string; status: string }>;
      try {
        rows = await tx.query<{ principal_id: string; role: string; status: string }>(
          `select principal_id, role, status from aura.revoke_membership($1, $2)`,
          [orgId, target.data]
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "42501") throw new AccessError("role_forbidden");
        if (code === "23514") throw new RequestError(409, "last_owner");
        if (code === "P0002") throw new RequestError(404, "membership_not_found");
        throw error;
      }
      const org = await tx.query<{ name: string }>(
        `select name from aura.organizations where id = $1`,
        [orgId]
      );
      const recipient = previous[0]?.email;
      return {
        body: { membership: rows[0] },
        after: recipient
          ? () =>
              send({
                template: "membership-revoked",
                to: recipient,
                idempotencyKey: `membership-revoked:${orgId}:${target.data}:${Date.now()}`,
                data: {
                  orgName: org[0]?.name ?? "your organization",
                  actorName: auth.displayName ?? auth.email,
                  appUrl: options.appOrigin,
                },
              })
          : undefined,
      };
    })
  );

  router.post(
    "/organizations/:orgId/invitations",
    authorized(services, { organization: true, roles: ["owner", "admin"] }, async ({ tx, orgId, req, auth }) => {
      const parsed = z
        .object({ email: z.string().max(320), role: invitableRole })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) throw new RequestError(400, "invalid_request");
      const email = normalizeRecipient(parsed.data.email);
      if (!email) throw new RequestError(400, "invalid_email");
      const token = newToken();
      const org = await tx.query<{ name: string }>(
        `select name from aura.organizations where id = $1`,
        [orgId]
      );
      let invitation: { id: string; expires_at: Date } | undefined;
      try {
        const rows = await tx.query<{ id: string; expires_at: Date }>(
          `insert into aura.invitations (org_id, email, role, token_hash, invited_by, expires_at)
           values ($1, $2, $3, $4, $5, now() + interval '7 days')
           returning id, expires_at`,
          [orgId, email, parsed.data.role, token.hash, auth.principalId]
        );
        invitation = rows[0];
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "42501") throw new AccessError("role_forbidden");
        if (code === "23505") throw new RequestError(409, "invitation_exists");
        throw error;
      }
      if (!invitation) throw new Error("Invitation failed");
      return {
        status: 201,
        body: { invitation: { id: invitation.id, email, role: parsed.data.role } },
        after: () =>
          send({
            template: "invitation",
            to: email,
            idempotencyKey: `invitation:${invitation.id}`,
            data: {
              inviterName: auth.displayName ?? auth.email,
              orgName: org[0]?.name ?? "an AURA organization",
              role: parsed.data.role,
              acceptUrl: `${options.appOrigin}/accept-invitation?token=${encodeURIComponent(
                token.token
              )}`,
              expiresInDays: 7,
            },
          }),
      };
    })
  );

  router.delete(
    "/organizations/:orgId/invitations/:invitationId",
    authorized(services, { organization: true, roles: ["owner", "admin"] }, async ({ tx, orgId, req }) => {
      const id = uuidField.safeParse(req.params.invitationId);
      if (!id.success) throw new RequestError(400, "invalid_request");
      const rows = await tx.query<{ id: string }>(
        `update aura.invitations set revoked_at = now()
          where id = $1 and org_id = $2 and accepted_at is null and revoked_at is null
          returning id`,
        [id.data, orgId]
      );
      if (!rows[0]) throw new RequestError(404, "invitation_not_found");
      return { body: { revoked: rows[0].id } };
    })
  );

  router.post("/invitations/accept", async (req, res, next) => {
    try {
      const context = getAuth(res);
      if (!context) return fail(res, 401, "authentication_required");
      const parsed = z.object({ token: z.string().min(16).max(200) }).strict().safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_request");
      try {
        const result = await services.db.transaction(async tx => {
          await tx.bindPrincipal(context.principalId);
          return tx.query<{ org_id: string; role: string }>(
            `select org_id, role from aura.accept_invitation($1::bytea)`,
            [hashToken(parsed.data.token)]
          );
        });
        return res.json({
          membership: result[0],
          organizations: await services.auth.memberships(context.principalId),
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        const message = (error as { message?: string }).message ?? "";
        if (
          code === "42501" ||
          code === "23505" ||
          code === "22023" ||
          code === "P0002" ||
          code === "28000"
        ) {
          const known = [
            "invitation_invalid",
            "invitation_revoked",
            "invitation_expired",
            "invitation_email_mismatch",
            "invitation_already_accepted",
          ];
          return fail(res, 400, known.includes(message) ? message : "invitation_invalid");
        }
        throw error;
      }
    } catch (error) {
      return next(error);
    }
  });

  // Tenant-scoped business data: the only rows this query can see are the ones
  // the RLS policies allow for the bound principal.
  router.get(
    "/projects",
    requireOrganization(services, async ({ tx }) => ({
      body: {
        projects: await tx.query(
          `select id, name, created_at as "createdAt" from aura.projects
            order by created_at desc, id`,
        ),
      },
    }))
  );

  router.post(
    "/projects",
    requireRole(services, ["owner", "admin", "member"], async ({ tx, orgId, req, auth }) => {
        const parsed = z.object({ name: nameField }).strict().safeParse(req.body);
        if (!parsed.success) throw new RequestError(400, "invalid_request");
        const rows = await tx.query<{ id: string; name: string }>(
          `insert into aura.projects (org_id, name, created_by)
           values ($1, $2, $3) returning id, name`,
          [orgId, parsed.data.name, auth.principalId]
        );
        return { status: 201, body: { project: rows[0] } };
    })
  );

  router.delete(
    "/projects/:projectId",
    requireRole(services, ["owner", "admin"], async ({ tx, req }) => {
        const id = uuidField.safeParse(req.params.projectId);
        if (!id.success) throw new RequestError(400, "invalid_request");
        const rows = await tx.query<{ id: string }>(
          `delete from aura.projects where id = $1 returning id`,
          [id.data]
        );
        if (!rows[0]) throw new RequestError(404, "project_not_found");
        return { body: { deleted: rows[0].id } };
    })
  );

  // Platform administration: read-only operational counters.
  router.get(
    "/admin/overview",
    requirePlatformAdmin(services, async ({ tx }) => {
        const [counts] = await tx.query<{
          principals: string;
          organizations: string;
          activeSessions: string;
        }>(
          `select (select count(*) from aura.principals)::text as principals,
                  (select count(*) from aura.organizations)::text as organizations,
                  (select count(*) from aura.sessions
                    where revoked_at is null and expires_at > now())::text as "activeSessions"`
        );
        return {
          body: {
            principals: Number(counts?.principals ?? 0),
            organizations: Number(counts?.organizations ?? 0),
            activeSessions: Number(counts?.activeSessions ?? 0),
          },
        };
      })
  );

  return router;
}
