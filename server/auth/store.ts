import type { Database, MembershipRole, Transaction } from "../db/database";
import { dummyEnvelope, hashPassword, verifyPassword } from "./password";
import { fingerprint, hashToken, newToken } from "./tokens";

export interface PrincipalRow {
  id: string;
  issuer: string;
  subject: string;
  email: string;
  display_name: string | null;
  email_verified_at: Date | null;
  disabled_at: Date | null;
}

export interface SessionRow {
  id: string;
  principal_id: string;
  csrf_hash: Buffer;
  expires_at: Date;
  email: string;
  display_name: string | null;
  email_verified_at: Date | null;
  disabled_at: Date | null;
}

export type LoginOutcome =
  | { status: "ok"; principal: PrincipalRow }
  | { status: "invalid" }
  | { status: "locked" }
  | { status: "disabled" };

/** Anything that can run a parameterized statement (pool or open transaction). */
export type Queryable = Pick<Transaction, "query">;

const principalColumns =
  "id, issuer, subject, email, display_name, email_verified_at, disabled_at";

export interface MembershipSummary {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
}

export class AuthStore {
  constructor(
    private readonly db: Database,
    private readonly options: {
      sessionTtlSeconds: number;
      tokenTtlSeconds: number;
      maxFailedAttempts: number;
      lockMinutes?: number;
    }
  ) {}

  async findPrincipalByEmail(
    email: string,
    scope: Queryable = this.db
  ): Promise<PrincipalRow | undefined> {
    const rows = await scope.query<PrincipalRow>(
      `select ${principalColumns} from aura.principals where email = $1`,
      [email]
    );
    return rows[0];
  }

  async principalById(id: string): Promise<PrincipalRow | undefined> {
    const rows = await this.db.query<PrincipalRow>(
      `select ${principalColumns} from aura.principals where id = $1`,
      [id]
    );
    return rows[0];
  }

  async findPrincipal(
    issuer: string,
    subject: string
  ): Promise<PrincipalRow | undefined> {
    const rows = await this.db.query<PrincipalRow>(
      `select ${principalColumns} from aura.principals where issuer = $1 and subject = $2`,
      [issuer, subject]
    );
    return rows[0];
  }

  /**
   * Creates the principal, its password credential and its first organization
   * in one transaction. The organization is created through the security
   * definer function so the membership row cannot be forged.
   */
  async registerLocal({
    email,
    password,
    displayName,
    organizationName,
    organizationSlug,
  }: {
    email: string;
    password: string;
    displayName?: string;
    organizationName: string;
    organizationSlug: string;
  }): Promise<{ principal: PrincipalRow; organizationId: string }> {
    const passwordHash = await hashPassword(password);
    return this.db.transaction(async tx => {
      const inserted = await tx.query<PrincipalRow>(
        `insert into aura.principals (issuer, subject, email, display_name)
         values ('local', gen_random_uuid()::text, $1, $2)
         returning ${principalColumns}`,
        [email, displayName ?? null]
      );
      const principal = inserted[0];
      if (!principal) throw new Error("Account creation failed");
      await tx.query(
        `insert into aura.credentials (principal_id, password_hash) values ($1, $2)`,
        [principal.id, passwordHash]
      );
      await tx.bindPrincipal(principal.id);
      const orgs = await tx.query<{ id: string }>(
        `select (aura.create_organization($1, $2)).id as id`,
        [organizationName, organizationSlug]
      );
      const organizationId = orgs[0]?.id;
      if (!organizationId) throw new Error("Organization creation failed");
      return { principal, organizationId };
    });
  }

  /** Links a provider-verified identity, creating the principal on first use. */
  async upsertProviderPrincipal({
    issuer,
    subject,
    email,
    emailVerified,
  }: {
    issuer: string;
    subject: string;
    email: string;
    emailVerified: boolean;
  }): Promise<PrincipalRow> {
    return this.db.transaction(async tx => {
      const existing = await tx.query<PrincipalRow>(
        `select ${principalColumns} from aura.principals where issuer = $1 and subject = $2`,
        [issuer, subject]
      );
      if (existing[0]) {
        await tx.query(
          `update aura.principals
              set email_verified_at = coalesce(email_verified_at, $2::timestamptz)
            where id = $1`,
          [existing[0].id, emailVerified ? new Date().toISOString() : null]
        );
        return { ...existing[0], email_verified_at: emailVerified ? new Date() : existing[0].email_verified_at };
      }
      const created = await tx.query<PrincipalRow>(
        `insert into aura.principals (issuer, subject, email, email_verified_at)
         values ($1, $2, $3, $4::timestamptz)
         returning ${principalColumns}`,
        [issuer, subject, email, emailVerified ? new Date().toISOString() : null]
      );
      if (!created[0]) throw new Error("Account creation failed");
      return created[0];
    });
  }

  async verifyLogin(email: string, password: string): Promise<LoginOutcome> {
    const rows = await this.db.query<
      PrincipalRow & {
        password_hash: string | null;
        failed_attempts: number | null;
        locked_until: Date | null;
      }
    >(
      `select ${principalColumns
        .split(", ")
        .map(column => `p.${column}`)
        .join(", ")}, c.password_hash,
              c.failed_attempts, c.locked_until
         from aura.principals p
         left join aura.credentials c on c.principal_id = p.id
        where p.email = $1`,
      [email]
    );
    const row = rows[0];
    // Always perform one derivation so an unknown address is not faster than a
    // wrong password.
    const matches = await verifyPassword(password, row?.password_hash ?? dummyEnvelope);
    if (!row) return { status: "invalid" };
    if (row.disabled_at) return { status: "disabled" };
    if (!row.password_hash) return { status: "invalid" };
    if (row.locked_until && row.locked_until.getTime() > Date.now())
      return { status: "locked" };
    if (!matches) {
      const attempts = (row.failed_attempts ?? 0) + 1;
      const lock = attempts >= this.options.maxFailedAttempts;
      await this.db.query(
        `update aura.credentials
            set failed_attempts = $2,
                locked_until = case when $3 then now() + interval '15 minutes' else locked_until end
          where principal_id = $1`,
        [row.id, attempts, lock]
      );
      return { status: "invalid" };
    }
    await this.db.query(
      `update aura.credentials
          set failed_attempts = 0, locked_until = null
        where principal_id = $1`,
      [row.id]
    );
    return {
      status: "ok",
      principal: {
        id: row.id,
        issuer: row.issuer,
        subject: row.subject,
        email: row.email,
        display_name: row.display_name,
        email_verified_at: row.email_verified_at,
        disabled_at: row.disabled_at,
      },
    };
  }

  async setPassword(principalId: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.db.query(
      `insert into aura.credentials (principal_id, password_hash, password_updated_at,
                                     failed_attempts, locked_until)
       values ($1, $2, now(), 0, null)
       on conflict (principal_id) do update
         set password_hash = excluded.password_hash,
             password_updated_at = now(),
             failed_attempts = 0,
             locked_until = null`,
      [principalId, passwordHash]
    );
  }

  async createSession({
    principalId,
    userAgent,
  }: {
    principalId: string;
    userAgent?: string;
  }): Promise<{ sessionId: string; sessionToken: string; csrfToken: string }> {
    const session = newToken();
    const csrf = newToken();
    const rows = await this.db.query<{ id: string }>(
      `insert into aura.sessions
         (principal_id, token_hash, csrf_hash, expires_at, user_agent_hash)
       values ($1, $2, $3, now() + ($4::text || ' seconds')::interval, $5)
       returning id`,
      [
        principalId,
        session.hash,
        csrf.hash,
        this.options.sessionTtlSeconds,
        fingerprint(userAgent),
      ]
    );
    const sessionId = rows[0]?.id;
    if (!sessionId) throw new Error("Session creation failed");
    return { sessionId, sessionToken: session.token, csrfToken: csrf.token };
  }

  async sessionByToken(token: string): Promise<SessionRow | undefined> {
    const rows = await this.db.query<SessionRow>(
      `select s.id, s.principal_id, s.csrf_hash, s.expires_at,
              p.email, p.display_name, p.email_verified_at, p.disabled_at
         from aura.sessions s
         join aura.principals p on p.id = s.principal_id
        where s.token_hash = $1
          and s.revoked_at is null
          and s.expires_at > now()`,
      [hashToken(token)]
    );
    const row = rows[0];
    if (!row || row.disabled_at) return undefined;
    await this.db.query(
      `update aura.sessions
          set last_seen_at = now()
        where id = $1 and last_seen_at < now() - interval '5 minutes'`,
      [row.id]
    );
    return row;
  }

  async revokeSession(
    sessionId: string,
    reason: string,
    scope: Queryable = this.db
  ): Promise<void> {
    await scope.query(
      `update aura.sessions
          set revoked_at = now(), revoked_reason = $2
        where id = $1 and revoked_at is null`,
      [sessionId, reason]
    );
  }

  async revokeAllSessions(principalId: string, reason: string): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `update aura.sessions
          set revoked_at = now(), revoked_reason = $2
        where principal_id = $1 and revoked_at is null
        returning id`,
      [principalId, reason]
    );
    return rows.length;
  }

  async issueAuthToken(
    principalId: string,
    kind: "email_verification" | "password_reset",
    scope?: Queryable
  ): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
    const issue = async (executor: Queryable) => {
      await executor.query(
        `update aura.auth_tokens
            set consumed_at = now()
          where principal_id = $1 and kind = $2 and consumed_at is null`,
        [principalId, kind]
      );
      const token = newToken();
      const rows = await executor.query<{ id: string; expires_at: Date }>(
        `insert into aura.auth_tokens (principal_id, kind, token_hash, expires_at)
         values ($1, $2, $3, now() + ($4::text || ' seconds')::interval)
         returning id, expires_at`,
        [principalId, kind, token.hash, this.options.tokenTtlSeconds]
      );
      const row = rows[0];
      if (!row) throw new Error("Token creation failed");
      return { token: token.token, tokenId: row.id, expiresAt: row.expires_at };
    };
    return scope ? issue(scope) : this.db.transaction(issue);
  }

  /** Single use: the atomic update is the consume, so a replay finds nothing. */
  async consumeAuthToken(
    kind: "email_verification" | "password_reset",
    token: string
  ): Promise<string | undefined> {
    if (typeof token !== "string" || token.length < 16 || token.length > 200)
      return undefined;
    const rows = await this.db.query<{ principal_id: string }>(
      `update aura.auth_tokens
          set consumed_at = now()
        where token_hash = $1 and kind = $2
          and consumed_at is null and expires_at > now()
        returning principal_id`,
      [hashToken(token), kind]
    );
    return rows[0]?.principal_id;
  }

  async markEmailVerified(principalId: string): Promise<void> {
    await this.db.query(
      `update aura.principals
          set email_verified_at = coalesce(email_verified_at, now())
        where id = $1`,
      [principalId]
    );
  }

  /**
   * Memberships are read inside a transaction with the principal bound, so the
   * row-level policies are evaluated against verified identity rather than an
   * unbound session.
   */
  async memberships(
    principalId: string,
    scope?: Queryable
  ): Promise<MembershipSummary[]> {
    const select = (executor: Queryable) =>
      executor.query<MembershipSummary>(
        `select o.id, o.name, o.slug, m.role
           from aura.memberships m
           join aura.organizations o on o.id = m.org_id
          where m.principal_id = $1 and m.status = 'active'
          order by o.created_at, o.id`,
        [principalId]
      );
    // A caller that already holds a transaction (with the principal bound)
    // shares it; otherwise a short transaction binds identity first so the
    // row-level policies are evaluated against verified identity.
    if (scope) return select(scope);
    return this.db.transaction(async tx => {
      await tx.bindPrincipal(principalId);
      return select(tx);
    });
  }

  async isPlatformAdmin(principalId: string): Promise<boolean> {
    const rows = await this.db.query<{ ok: boolean }>(
      `select true as ok from aura.platform_admins where principal_id = $1`,
      [principalId]
    );
    return rows.length === 1;
  }

  /** Auth throttle counters are keyed by hashes so no address is stored. */
  async hitAuthRateLimit(
    bucket: string,
    windowSeconds: number,
    scope: Queryable = this.db
  ): Promise<number> {
    const rows = await scope.query<{ hits: number }>(
      `insert into aura.auth_rate_limits (bucket, window_start, hits)
       values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
       on conflict (bucket, window_start)
         do update set hits = aura.auth_rate_limits.hits + 1
       returning hits`,
      [bucket, windowSeconds]
    );
    return Number(rows[0]?.hits ?? 0);
  }

  static emailBucket(prefix: string, email: string) {
    return `${prefix}:${hashToken(email).toString("hex").slice(0, 32)}`;
  }
}
