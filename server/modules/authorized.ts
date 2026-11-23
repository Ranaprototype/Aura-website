import type { NextFunction, Request, RequestHandler, Response } from "express";
import { SESSION_COOKIE } from "../http/cookies";
import { AccessError, requireMembership, type MembershipRole, type Transaction } from "../db/database";
import { CSRF_COOKIE, parseCookies, setCookie } from "../http/cookies";
import { fail, RequestError } from "../http/errors";
import { newToken, sameToken, tokenMatches } from "../auth/tokens";
import type { AppServices } from "../services";

export interface AuthContext {
  sessionId: string;
  principalId: string;
  csrfHash: Buffer;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
}

export const getAuth = (res: Response): AuthContext | undefined =>
  res.locals.auth as AuthContext | undefined;

export const setAuth = (res: Response, auth: AuthContext | undefined) => {
  res.locals.auth = auth;
};

const unsafe = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method);

/**
 * Global CSRF gate for the versioned API: origin allowlisting plus the
 * double-submit cookie. Session-bound verification is added per route below.
 */
export function csrfGuard(services: AppServices): RequestHandler {
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    let cookieToken = cookies[CSRF_COOKIE];
    if (!cookieToken) {
      cookieToken = newToken().token;
      setCookie(res, CSRF_COOKIE, cookieToken, {
        maxAge: 60 * 60 * 24 * 7,
        httpOnly: false,
        secure: services.secureCookies,
        sameSite: "Lax",
      });
    }
    if (!unsafe(req.method)) return next();
    const origin = req.get("origin");
    if (origin && services.appOrigin && origin !== services.appOrigin)
      return fail(res, 403, "origin_rejected");
    if (req.get("sec-fetch-site") === "cross-site")
      return fail(res, 403, "origin_rejected");
    const header = req.get("x-csrf-token");
    if (!sameToken(header, cookieToken)) return fail(res, 403, "csrf_failed");
    next();
  };
}

/**
 * Resolves the opaque session cookie into a verified principal. Mounted for the
 * whole versioned API so every route (not only the auth routes) sees the same
 * server-side decision.
 */
export function attachSession(services: AppServices): RequestHandler {
  return (req, res, next) => {
    setAuth(res, undefined);
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    services.auth
      .sessionByToken(token)
      .then(row => {
        if (row) setAuth(res, sessionFromRow(row));
        next();
      })
      .catch(next);
  };
}

export interface RequestContext {
  req: Request;
  res: Response;
  auth: AuthContext;
  tx: Transaction;
  orgId?: string;
  role?: MembershipRole;
  services: AppServices;
}

export type HandlerResult = {
  status?: number;
  body?: unknown;
  /** Runs after commit, before the response is written (no provider call while
   * a database connection is held). */
  after?: () => Promise<unknown>;
};

export interface RouteOptions {
  /** Require an active server-side session (default true). */
  session?: boolean;
  /** Require a bound organization resolved from active membership. */
  organization?: boolean;
  /** Restrict the organization role. */
  roles?: readonly MembershipRole[];
  /** Require a confirmed email address (defaults to true for sessions). */
  verifiedEmail?: boolean;
  /** Require the platform administrator grant. */
  platformAdmin?: boolean;
}

const errorStatus = (code: string) => {
  switch (code) {
    case "identity_required":
    case "session_invalid":
      return 401;
    case "organization_required":
      return 400;
    case "email_unverified":
      return 403;
    case "organization_forbidden":
    case "role_forbidden":
      return 403;
    default:
      return 500;
  }
};

/**
 * One transaction per request. The verified principal is bound transaction
 * locally, membership is resolved from authoritative rows, and the response is
 * only produced after commit.
 */
export function authorized(
  services: AppServices,
  options: RouteOptions,
  handler: (context: RequestContext) => Promise<HandlerResult>
): RequestHandler {
  return async (req, res, next) => {
    const auth = getAuth(res);
    if (!auth) return fail(res, 401, "authentication_required");
    if (options.verifiedEmail !== false && !auth.emailVerified)
      return fail(res, 403, "email_unverified");
    if (unsafe(req.method)) {
      const header = req.get("x-csrf-token");
      if (!tokenMatches(header, auth.csrfHash)) return fail(res, 403, "csrf_failed");
    }
    const requestedOrg = req.get("x-aura-org");
    if (options.organization) {
      if (!requestedOrg) return fail(res, 400, "organization_required");
      if (!/^[0-9a-f-]{36}$/i.test(requestedOrg))
        return fail(res, 400, "organization_required");
    } else if (requestedOrg && !/^[0-9a-f-]{36}$/i.test(requestedOrg)) {
      return fail(res, 400, "organization_required");
    }

    try {
      const result = await services.db.transaction(async tx => {
        await tx.bindPrincipal(auth.principalId);
        if (options.platformAdmin) {
          const admin = await tx.query(
            `select 1 from aura.platform_admins where principal_id = $1`,
            [auth.principalId]
          );
          if (!admin.length) throw new AccessError("role_forbidden");
        }
        let role: MembershipRole | undefined;
        if (requestedOrg && options.organization) {
          role = await requireMembership(tx, requestedOrg, options.roles);
          await tx.bindOrganization(requestedOrg, role);
        } else if (options.roles) {
          throw new AccessError("organization_required");
        }
        return handler({
          req,
          res,
          auth,
          tx,
          orgId: options.organization ? requestedOrg : undefined,
          role,
          services,
        });
      });
      if (result.after) await result.after();
      if (res.headersSent) return;
      return res.status(result.status ?? 200).json(result.body ?? { ok: true });
    } catch (error) {
      if (error instanceof RequestError)
        return fail(res, error.status, error.code);
      if (error instanceof AccessError) {
        services.logger.warn("authorization_denied", {
          route: `${req.method} ${req.baseUrl}${req.path}`,
          code: error.code,
        });
        return fail(res, errorStatus(error.code), error.code);
      }
      return next(error);
    }
  };
}

/**
 * Named guards required by the Phase 2 review checklist. They are thin wrappers
 * around `authorized` so each rule has one obvious entry point.
 */

/** Any active membership of the requested organization. */
export const requireOrganization = (
  services: AppServices,
  handler: (context: RequestContext) => Promise<HandlerResult>
) => authorized(services, { organization: true }, handler);

/** Membership of the requested organization with one of these roles. */
export const requireRole = (
  services: AppServices,
  roles: readonly MembershipRole[],
  handler: (context: RequestContext) => Promise<HandlerResult>
) => authorized(services, { organization: true, roles }, handler);

/** The database-backed platform administrator grant; no environment switch. */
export const requirePlatformAdmin = (
  services: AppServices,
  handler: (context: RequestContext) => Promise<HandlerResult>
) => authorized(services, { platformAdmin: true, verifiedEmail: false }, handler);

export function sessionFromRow(row: {
  id: string;
  principal_id: string;
  csrf_hash: Buffer;
  email: string;
  display_name: string | null;
  email_verified_at: Date | null;
}): AuthContext {
  return {
    sessionId: row.id,
    principalId: row.principal_id,
    csrfHash: row.csrf_hash,
    email: row.email,
    displayName: row.display_name,
    emailVerified: Boolean(row.email_verified_at),
  };
}

export type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;
