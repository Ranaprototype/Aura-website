import express from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AccessError } from "../db/database";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  parseCookies,
  setCookie,
} from "../http/cookies";
import { fail } from "../http/errors";
import { passwordPolicyError } from "../auth/password";
import { normalizeRecipient, type EmailTemplateName } from "../email/templates";
import { AuthStore } from "../auth/store";
import type { AppServices } from "../services";
import {
  authorized,
  csrfGuard,
  getAuth,
  sessionFromRow,
  setAuth,
} from "./authorized";

const emailField = z
  .string()
  .max(320)
  .transform(value => value.trim().toLowerCase())
  .refine(value => normalizeRecipient(value) === value, "invalid_email");

const passwordField = z.string().max(200);

const registerBody = z
  .object({
    email: emailField,
    password: passwordField,
    displayName: z.string().trim().min(1).max(120).optional(),
    organizationName: z.string().trim().min(1).max(120).optional(),
    organizationSlug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
      .optional(),
  })
  .strict();

const loginBody = z
  .object({ email: emailField, password: passwordField })
  .strict();

const tokenBody = z.object({ token: z.string().min(16).max(200) }).strict();

const resetBody = z
  .object({ token: z.string().min(16).max(200), password: passwordField })
  .strict();

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "workspace";

export const uniqueSlug = (base: string) =>
  `${slugify(base).replace(/-+$/g, "").slice(0, 48)}-${randomBytes(4).toString("hex")}`;

const clientKey = (req: express.Request) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  return ip.replace(/[^0-9a-f:.]/gi, "").slice(0, 60);
};

export function authRoutes(services: AppServices, options: { appOrigin: string }) {
  const router = express.Router();
  const { auth, logger } = services;

  router.use(csrfGuard(services));

  const attachSession = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    setAuth(res, undefined);
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    try {
      const row = await auth.sessionByToken(token);
      if (row) setAuth(res, sessionFromRow(row));
      return next();
    } catch (error) {
      return next(error);
    }
  };
  router.use((req, res, next) => {
    void attachSession(req, res, next);
  });

  const issueSession = async (
    res: express.Response,
    principalId: string,
    userAgent: string | undefined
  ) => {
    const session = await auth.createSession({ principalId, userAgent });
    setCookie(res, SESSION_COOKIE, session.sessionToken, {
      maxAge: 24 * 3600,
      httpOnly: true,
      secure: services.secureCookies,
      sameSite: "Lax",
    });
    // Rotate the double-submit token at every privilege change so a token that
    // was captured before sign-in cannot be replayed afterwards.
    setCookie(res, CSRF_COOKIE, session.csrfToken, {
      maxAge: 24 * 3600,
      httpOnly: false,
      secure: services.secureCookies,
      sameSite: "Lax",
    });
    return session;
  };

  const clearSessionCookies = (res: express.Response) => {
    clearCookie(res, SESSION_COOKIE, { secure: services.secureCookies, httpOnly: true });
    clearCookie(res, CSRF_COOKIE, { secure: services.secureCookies, httpOnly: false });
  };

  const verifyUrl = (token: string) =>
    `${options.appOrigin}/verify-email?token=${encodeURIComponent(token)}`;
  const resetUrl = (token: string) =>
    `${options.appOrigin}/reset-password?token=${encodeURIComponent(token)}`;

  const send = async (input: {
    template: EmailTemplateName;
    to: unknown;
    data: unknown;
    idempotencyKey: string;
  }) => {
    if (!services.email) {
      logger.warn("email_unavailable", { template: input.template });
      return;
    }
    try {
      await services.email.send(input);
    } catch {
      logger.error("email_dispatch_error", { template: input.template });
    }
  };

  const sessionSummary = async (principalId: string) => ({
    organizations: await auth.memberships(principalId),
    // Presentation only: every platform route re-checks this grant in the database.
    platformAdmin: await auth.isPlatformAdmin(principalId),
  });

  router.post("/register", async (req, res, next) => {
    try {
      const limited = await auth.hitAuthRateLimit(`auth:register:${clientKey(req)}`, 3600);
      if (limited > services.limits.registerHourly)
        return fail(res, 429, "rate_limited");
      const parsed = registerBody.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_request");
      const { email, password, displayName, organizationName, organizationSlug } =
        parsed.data;
      const policy = passwordPolicyError(password);
      if (policy) return fail(res, 400, policy);
      const orgName =
        organizationName ?? `${displayName ?? email.split("@")[0]}'s workspace`;
      let result: { principal: { id: string }; organizationId: string };
      try {
        result = await auth.registerLocal({
          email,
          password,
          displayName,
          organizationName: orgName,
          organizationSlug: organizationSlug ?? uniqueSlug(orgName),
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") return fail(res, 409, "email_unavailable");
        throw error;
      }
      await issueSession(res, result.principal.id, req.get("user-agent"));
      const verification = await auth.issueAuthToken(
        result.principal.id,
        "email_verification"
      );
      await send({
        template: "welcome",
        to: email,
        idempotencyKey: `welcome:${result.principal.id}`,
        data: { name: displayName ?? email.split("@")[0], orgName, appUrl: options.appOrigin },
      });
      await send({
        template: "verify-email",
        to: email,
        idempotencyKey: `verify-email:${verification.tokenId}`,
        data: {
          name: displayName ?? email.split("@")[0],
          verifyUrl: verifyUrl(verification.token),
          expiresInMinutes: Math.round(
            (verification.expiresAt.getTime() - Date.now()) / 60_000
          ),
        },
      });
      logger.info("account_registered", { principalId: result.principal.id });
      return res.status(201).json({
        principal: {
          id: result.principal.id,
          email,
          displayName: displayName ?? null,
          emailVerified: false,
        },
        organization: { id: result.organizationId },
        organizations: await auth.memberships(result.principal.id),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/login", async (req, res, next) => {
    try {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_request");
      const { email, password } = parsed.data;
      const ipHits = await auth.hitAuthRateLimit(`auth:login:ip:${clientKey(req)}`, 600);
      const emailHits = await auth.hitAuthRateLimit(`auth:login:${AuthStore.emailBucket("email", email)}`, 600);
      if (
        ipHits > services.limits.loginIp ||
        emailHits > services.limits.loginEmail
      )
        return fail(res, 429, "rate_limited");
      const outcome = await auth.verifyLogin(email, password);
      if (outcome.status !== "ok") {
        logger.warn("login_rejected", { code: outcome.status });
        return fail(res, 401, "invalid_credentials");
      }
      await issueSession(res, outcome.principal.id, req.get("user-agent"));
      logger.info("login_succeeded", { principalId: outcome.principal.id });
      return res.json({
        principal: {
          id: outcome.principal.id,
          email: outcome.principal.email,
          displayName: outcome.principal.display_name,
          emailVerified: Boolean(outcome.principal.email_verified_at),
        },
        ...(await sessionSummary(outcome.principal.id)),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/session", async (req, res, next) => {
    try {
      const authContext = getAuth(res);
      if (!authContext) return res.json({ authenticated: false });
      return res.json({
        authenticated: true,
        principal: {
          id: authContext.principalId,
          email: authContext.email,
          displayName: authContext.displayName,
          emailVerified: authContext.emailVerified,
        },
        ...(await sessionSummary(authContext.principalId)),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    "/logout",
    authorized(
      services,
      { verifiedEmail: false },
      async ({ auth: context, tx, res }) => {
        await auth.revokeSession(context.sessionId, "logout", tx);
        clearSessionCookies(res);
        return { body: { ok: true } };
      }
    )
  );

  router.post("/email/verify", async (req, res, next) => {
    try {
      const parsed = tokenBody.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_request");
      const principalId = await auth.consumeAuthToken(
        "email_verification",
        parsed.data.token
      );
      if (!principalId) return fail(res, 400, "token_invalid");
      await auth.markEmailVerified(principalId);
      const context = getAuth(res);
      if (context?.principalId === principalId) {
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        const row = token ? await auth.sessionByToken(token) : undefined;
        if (row) setAuth(res, sessionFromRow(row));
      }
      logger.info("email_verified", { principalId });
      return res.json({ verified: true });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    "/email/resend",
    authorized(services, { verifiedEmail: false }, async ({ auth: context, tx }) => {
      const hits = await auth.hitAuthRateLimit(
        `auth:verify:${AuthStore.emailBucket("email", context.email)}`,
        3600,
        tx
      );
      if (hits > 5) throw new AccessError("role_forbidden");
      const principal = await auth.findPrincipalByEmail(context.email, tx);
      if (!principal)
        throw new AccessError("session_invalid");
      if (principal.email_verified_at) return { body: { sent: false, verified: true } };
      const token = await auth.issueAuthToken(principal.id, "email_verification", tx);
      const content = {
        template: "verify-email" as const,
        to: principal.email,
        idempotencyKey: `verify-email:${token.tokenId}`,
        data: {
          name: principal.display_name ?? principal.email.split("@")[0],
          verifyUrl: verifyUrl(token.token),
          expiresInMinutes: Math.round(
            (token.expiresAt.getTime() - Date.now()) / 60_000
          ),
        },
      };
      // Delivery happens after commit: no provider call while a database
      // connection is held.
      return { body: { sent: true }, after: () => send(content) };
    })
  );

  router.post("/password/forgot", async (req, res, next) => {
    try {
      const parsed = z.object({ email: emailField }).strict().safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_request");
      const { email } = parsed.data;
      const hits = await auth.hitAuthRateLimit(
        `auth:forgot:${AuthStore.emailBucket("email", email)}`,
        3600
      );
      // The response is identical whether or not the address exists, so this
      // endpoint cannot be used to enumerate accounts.
      if (hits <= 3) {
        const principal = await auth.findPrincipalByEmail(email);
        if (principal && !principal.disabled_at) {
          const token = await auth.issueAuthToken(principal.id, "password_reset");
          await send({
            template: "password-reset",
            to: principal.email,
            idempotencyKey: `password-reset:${token.tokenId}`,
            data: {
              name: principal.display_name ?? principal.email.split("@")[0],
              resetUrl: resetUrl(token.token),
              expiresInMinutes: Math.round(
                (token.expiresAt.getTime() - Date.now()) / 60_000
              ),
            },
          });
        }
      }
      return res.status(202).json({ accepted: true });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/password/reset", async (req, res, next) => {
    try {
      const parsed = resetBody.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_request");
      const policy = passwordPolicyError(parsed.data.password);
      if (policy) return fail(res, 400, policy);
      const principalId = await auth.consumeAuthToken(
        "password_reset",
        parsed.data.token
      );
      if (!principalId) return fail(res, 400, "token_invalid");
      await auth.setPassword(principalId, parsed.data.password);
      // A reset revokes every session, including the one that requested it.
      await auth.revokeAllSessions(principalId, "password_reset");
      const owner = await auth.principalById(principalId);
      clearSessionCookies(res);
      if (owner) {
        await send({
          template: "security-alert",
          to: owner.email,
          idempotencyKey: `security-alert:password-reset:${principalId}:${Date.now()}`,
          data: {
            name: owner.display_name ?? owner.email.split("@")[0],
            detail: "Your AURA password was reset and every existing session was signed out.",
            occurredAt: new Date().toISOString(),
            appUrl: options.appOrigin,
          },
        });
      }
      logger.info("password_reset", { principalId });
      return res.json({ reset: true });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/supabase", async (req, res, next) => {
    try {
      if (!services.identity) return fail(res, 501, "identity_provider_unavailable");
      const parsed = z
        .object({ accessToken: z.string().min(20).max(4096) })
        .strict()
        .safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "invalid_request");
      let identity;
      try {
        identity = await services.identity.verify(parsed.data.accessToken);
      } catch {
        return fail(res, 401, "invalid_credentials");
      }
      const principal = await auth.upsertProviderPrincipal(identity);
      if (principal.disabled_at) return fail(res, 401, "invalid_credentials");
      await issueSession(res, principal.id, req.get("user-agent"));
      logger.info("login_succeeded", { principalId: principal.id });
      return res.json({
        principal: {
          id: principal.id,
          email: principal.email,
          displayName: principal.display_name,
          emailVerified: Boolean(principal.email_verified_at),
        },
        ...(await sessionSummary(principal.id)),
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
