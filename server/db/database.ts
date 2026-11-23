import { Pool, type PoolClient } from "pg";

/**
 * Raised for every authorization decision that fails. The HTTP layer maps it to
 * a generic response; the message never contains a token, an email or SQL.
 */
export class AccessError extends Error {
  constructor(
    readonly code:
      | "identity_required"
      | "session_invalid"
      | "organization_required"
      | "organization_forbidden"
      | "role_forbidden"
      | "email_unverified",
    message = code
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export interface Transaction {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<R[]>;
  /** Bind the verified principal for this transaction only. */
  bindPrincipal(principalId: string): Promise<void>;
  /** Bind an organization after the membership row was authorized. */
  bindOrganization(orgId: string, role: MembershipRole): Promise<void>;
}

export type MembershipRole = "owner" | "admin" | "member" | "viewer";

export interface Database {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<R[]>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PgDatabase implements Database {
  private readonly pool: Pool;
  private readonly role?: string;
  private closed = false;

  constructor({
    url,
    max = 5,
    role,
  }: {
    url: string;
    max?: number;
    /**
     * Disposable-engine harness only. On a managed target the login itself is
     * the restricted role; here the embedded engine authenticates everyone as
     * an administrator, so every unit of work explicitly assumes the
     * non-owner role. The role is transaction local, so it cannot leak.
     */
    role?: string;
  }) {
    this.pool = new Pool({
      connectionString: url,
      max,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      application_name: "aura-api",
      statement_timeout: 5_000,
      query_timeout: 5_000,
    });
    this.role = role;
  }

  async query<R = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<R[]> {
    if (!this.role) {
      const result = await this.pool.query(sql, params as unknown[]);
      return result.rows as R[];
    }
    const client = await this.pool.connect();
    try {
      await client.query(`set role ${this.role}`);
      const result = await client.query(sql, params as unknown[]);
      return result.rows as R[];
    } finally {
      try {
        await client.query("reset role");
      } catch {
        // The connection is discarded on the next release anyway.
      }
      client.release();
    }
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query("begin");
      if (this.role) await client.query(`set local role ${this.role}`);
      const tx = this.scope(client);
      const result = await fn(tx);
      await client.query("commit");
      return result;
    } catch (error) {
      broken = true;
      try {
        await client.query("rollback");
      } catch {
        // A connection that cannot roll back is discarded below.
      }
      throw error;
    } finally {
      // Transaction-local settings vanish at commit/rollback, but reset
      // everything and discard the connection if its state is uncertain so no
      // buffered session settings can reach the next borrower.
      if (!broken) {
        try {
          // DISCARD ALL also resets the session role and any lingering
          // transaction-local settings before the connection is reused.
          await client.query("discard all");
        } catch {
          broken = true;
        }
      }
      client.release(broken);
    }
  }

  private scope(client: PoolClient): Transaction {
    const query: Transaction["query"] = async <R,>(sql: string, params: readonly unknown[] = []) => {
      const result = await client.query(sql, params as unknown[]);
      return result.rows as R[];
    };
    return {
      query,
      async bindPrincipal(principalId) {
        if (!uuidPattern.test(principalId))
          throw new AccessError("identity_required");
        // set_config with is_local = true: the value dies with the transaction
        // and can never leak to the next checkout of a pooled connection.
        await query("select set_config('aura.principal_id', $1, true)", [
          principalId,
        ]);
      },
      async bindOrganization(orgId, role) {
        if (!uuidPattern.test(orgId)) throw new AccessError("organization_forbidden");
        await query("select set_config('aura.org_id', $1, true)", [orgId]);
        // The role is recorded for auditing; policies re-derive it from the
        // membership rows and never trust this setting.
        await query("select set_config('aura.role', $1, true)", [role]);
      },
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}

/** Resolve an active membership inside the current transaction, or deny. */
export async function requireMembership(
  tx: Transaction,
  orgId: string,
  roles?: readonly MembershipRole[]
): Promise<MembershipRole> {
  const rows = await tx.query<{ role: MembershipRole }>(
    `select role from aura.memberships
      where org_id = $1 and principal_id = aura.current_principal()
        and status = 'active'`,
    [orgId]
  );
  const membership = rows[0];
  if (!membership) throw new AccessError("organization_forbidden");
  if (roles && !roles.includes(membership.role))
    throw new AccessError("role_forbidden");
  return membership.role;
}
