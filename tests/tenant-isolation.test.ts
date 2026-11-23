/**
 * Runtime PostgreSQL verification of the identity boundary.
 *
 * Every statement below runs through the real `pg` driver against a disposable
 * PostgreSQL instance, as the restricted `aura_app` role (non-owner, no
 * BYPASSRLS), with identity bound transaction-locally. No shared or production
 * database is contacted.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, type TestDatabase } from "./support/database";
import { PgDatabase, type Transaction } from "../server/db/database";

let test: TestDatabase;
let db: PgDatabase;
let admin: PgDatabase;

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VIEWER_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ADMIN_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTSIDER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const expects = async (promise: Promise<unknown>, pattern: RegExp) => {
  await expect(promise).rejects.toThrow(pattern);
};

beforeAll(async () => {
  test = await startTestDatabase();
  db = test.db;
  admin = test.admin;
  // Fixtures model existing authoritative records; they are created by the
  // operator handle, not by the runtime role.
  await admin.query(
    `insert into aura.principals (id, issuer, subject, email, display_name) values
       ($1,'local','owner-a','owner-a@example.test','Owner A'),
       ($2,'local','owner-b','owner-b@example.test','Owner B'),
       ($3,'local','member-a','member-a@example.test','Member A'),
       ($4,'local','viewer-a','viewer-a@example.test','Viewer A'),
       ($5,'local','admin-a','admin-a@example.test','Admin A'),
       ($6,'local','outsider','outsider@example.test','Outsider')`,
    [OWNER_A, OWNER_B, MEMBER_A, VIEWER_A, ADMIN_A, OUTSIDER]
  );
  await admin.query(
    `insert into aura.organizations (id, name, slug, created_by) values
       ($1,'Tenant A','tenant-a',$3),
       ($2,'Tenant B','tenant-b',$4)`,
    [ORG_A, ORG_B, OWNER_A, OWNER_B]
  );
  await admin.query(
    `insert into aura.memberships (org_id, principal_id, role) values
       ($1,$3,'owner'), ($1,$4,'member'), ($1,$5,'viewer'), ($1,$6,'admin'),
       ($2,$7,'owner'), ($2,$8,'member')`,
    [ORG_A, ORG_B, OWNER_A, MEMBER_A, VIEWER_A, ADMIN_A, OWNER_B, OUTSIDER]
  );
  await admin.query(
    `insert into aura.projects (org_id, name, created_by) values
       ($1,'A project',$2), ($3,'B project',$4)`,
    [ORG_A, OWNER_A, ORG_B, OWNER_B]
  );
});

afterAll(async () => {
  await test.close();
});

/** Runs a callback inside a transaction that has the principal (and org) bound. */
const asPrincipal = async <T>(
  principalId: string,
  fn: (tx: Transaction) => Promise<T>,
  orgId?: string
) =>
  db.transaction(async tx => {
    await tx.bindPrincipal(principalId);
    if (orgId) {
      const rows = await tx.query<{ role: string }>(
        `select role from aura.memberships
          where org_id = $1 and principal_id = $2 and status = 'active'`,
        [orgId, principalId]
      );
      if (!rows[0]) throw new Error("organization_forbidden");
      await tx.bindOrganization(orgId, rows[0].role as "owner");
    }
    return fn(tx);
  });

describe("row level security", () => {
  it("denies an unbound runtime query and an unbound write", async () => {
    const rows = await db.query(`select id from aura.projects`);
    expect(rows).toEqual([]);
    await expects(
      db.query(
        `insert into aura.projects (org_id, name, created_by) values ($1,'forged',$2)`,
        [ORG_A, OWNER_A]
      ),
      /row-level security|permission denied/i
    );
    expect(await db.query(`select count(*)::int as count from aura.projects`)).toEqual([
      { count: 0 },
    ]);
  });

  it("shows an authorized member only their own tenant rows", async () => {
    const rows = await asPrincipal(OWNER_A, tx =>
      tx.query<{ name: string; org_id: string }>(`select name, org_id from aura.projects`)
    );
    expect(rows.map(row => row.name)).toEqual(["A project"]);
    expect(rows[0]?.org_id).toBe(ORG_A);
  });

  it("lets an owner write and blocks a viewer write", async () => {
    const created = await asPrincipal(OWNER_A, tx =>
      tx.query<{ id: string }>(
        `insert into aura.projects (org_id, name, created_by) values ($1,'A second',$2) returning id`,
        [ORG_A, OWNER_A]
      )
    );
    expect(created[0]?.id).toBeTruthy();

    await expects(
      asPrincipal(VIEWER_A, tx =>
        tx.query(
          `insert into aura.projects (org_id, name, created_by) values ($1,'viewer write',$2)`,
          [ORG_A, VIEWER_A]
        )
      ),
      /row-level security|permission denied/i
    );
  });

  it("cannot read, list, mutate or extend another tenant even with its identifiers", async () => {
    const read = await asPrincipal(OWNER_A, tx =>
      tx.query(`select id from aura.projects where org_id = $1`, [ORG_B])
    );
    expect(read).toEqual([]);

    const updated = await asPrincipal(OWNER_A, tx =>
      tx.query(`update aura.projects set name = 'hijacked' where org_id = $1 returning id`, [
        ORG_B,
      ])
    );
    expect(updated).toEqual([]);

    const deleted = await asPrincipal(OWNER_A, tx =>
      tx.query(`delete from aura.projects where org_id = $1 returning id`, [ORG_B])
    );
    expect(deleted).toEqual([]);

    await expects(
      asPrincipal(OWNER_A, tx =>
        tx.query(
          `insert into aura.projects (org_id, name, created_by) values ($1,'child of B',$2)`,
          [ORG_B, OWNER_A]
        )
      ),
      /row-level security|permission denied/i
    );

    // Nothing changed on the other side.
    const untouched = await admin.query<{ name: string }>(
      `select name from aura.projects where org_id = $1`,
      [ORG_B]
    );
    expect(untouched.map(row => row.name)).toEqual(["B project"]);
  });

  it("ignores a forged role setting and an unverified organization hint", async () => {
    const rows = await db.transaction(async tx => {
      await tx.bindPrincipal(OUTSIDER);
      // An attacker who could reach the SQL session still cannot forge a role.
      await tx.query(`select set_config('aura.role', 'owner', true)`);
      await tx.query(`select set_config('aura.org_id', $1, true)`, [ORG_A]);
      return tx.query(`select id from aura.projects`);
    });
    // OUTSIDER is a member of B only: no rows from A appear even though the
    // transaction claims A as its organization and a fake owner role.
    expect(rows).toHaveLength(1);
  });

  it("denies every membership the principal does not actively hold", async () => {
    const rows = await asPrincipal(OUTSIDER, tx =>
      tx.query(`select org_id, role from aura.memberships`)
    );
    expect(rows).toEqual([{ org_id: ORG_B, role: "member" }]);
  });
});

describe("identity requirements", () => {
  it("refuses provisioning functions without a bound principal", async () => {
    await expects(
      db.transaction(tx =>
        tx.query(`select (aura.create_organization('No identity','no-identity')).*`)
      ),
      /identity_required/
    );
    await expects(
      db.transaction(tx =>
        tx.query(`select * from aura.accept_invitation($1::bytea)`, [
          Buffer.from("0123456789abcdef0123456789abcdef", "hex"),
        ])
      ),
      /identity_required/
    );
  });

  it("cannot mint an organization or membership through direct DML", async () => {
    await expects(
      asPrincipal(OWNER_A, tx =>
        tx.query(`insert into aura.organizations (name, slug) values ('forged','forged-org')`)
      ),
      /permission denied/i
    );
    await expects(
      asPrincipal(OUTSIDER, tx =>
        tx.query(`insert into aura.memberships (org_id, principal_id, role) values ($1,$2,'owner')`, [
          ORG_A,
          OUTSIDER,
        ])
      ),
      /permission denied/i
    );
  });

  it("rejects an organization the caller does not belong to before any work", async () => {
    await expect(asPrincipal(OUTSIDER, () => Promise.resolve(), ORG_A)).rejects.toThrow(
      /organization_forbidden/
    );
  });
});

describe("membership revocation", () => {
  it("denies the very next request after revocation commits", async () => {
    await admin.query(
      `insert into aura.principals (id, issuer, subject, email) values
        ('99999999-9999-4999-8999-999999999999','local','revoked-member','revoked@example.test')`
    );
    const principal = "99999999-9999-4999-8999-999999999999";
    await admin.query(
      `insert into aura.memberships (org_id, principal_id, role) values ($1,$2,'member')`,
      [ORG_A, principal]
    );
    expect(
      (await asPrincipal(principal, tx => tx.query(`select id from aura.projects`))).length
    ).toBeGreaterThan(0);

    await asPrincipal(OWNER_A, tx =>
      tx.query(`select * from aura.revoke_membership($1, $2)`, [ORG_A, principal])
    );

    const after = await asPrincipal(principal, tx =>
      tx.query(`select id from aura.projects`)
    );
    expect(after).toEqual([]);
    await expects(
      asPrincipal(principal, () => Promise.resolve(), ORG_A),
      /organization_forbidden/
    );
    // A write attempt after revocation changes nothing.
    await expects(
      asPrincipal(principal, tx =>
        tx.query(
          `insert into aura.projects (org_id, name, created_by) values ($1,'after revoke',$2)`,
          [ORG_A, principal]
        )
      ),
      /row-level security|permission denied/i
    );
  });
});

describe("pooled connection identity isolation", () => {
  it("never leaks identity between checkouts, including after commit and rollback", async () => {
    // A separate single-connection pool forces every checkout onto one backend.
    const pooled = new PgDatabase({ url: test.url, role: "aura_app", max: 1 });
    try {
      const bound = () =>
        pooled.query<{ principal: string | null; org: string | null }>(
          `select aura.current_principal() as principal, aura.current_org() as org`
        );

      expect(await bound()).toEqual([{ principal: null, org: null }]);

      const aRows = await pooled.transaction(async tx => {
        await tx.bindPrincipal(OWNER_A);
        return tx.query<{ name: string }>(`select name from aura.projects`);
      });
      expect(aRows.map(row => row.name).sort()).toEqual(["A project", "A second"]);

      // Same physical backend, new transaction, no identity.
      expect(await bound()).toEqual([{ principal: null, org: null }]);
      expect(await pooled.query(`select id from aura.projects`)).toEqual([]);

      const bRows = await pooled.transaction(async tx => {
        await tx.bindPrincipal(OWNER_B);
        return tx.query<{ name: string }>(`select name from aura.projects`);
      });
      expect(bRows.map(row => row.name)).toEqual(["B project"]);

      // A rolled-back transaction must also leave nothing behind.
      await expect(
        pooled.transaction(async tx => {
          await tx.bindPrincipal(OWNER_A);
          await tx.query(`select set_config('aura.org_id', $1, true)`, [ORG_A]);
          const rows = await tx.query(`select name from aura.projects`);
          expect(rows).toHaveLength(2);
          throw new Error("forced rollback");
        })
      ).rejects.toThrow(/forced rollback/);

      expect(await bound()).toEqual([{ principal: null, org: null }]);
      expect(await pooled.query(`select id from aura.projects`)).toEqual([]);
    } finally {
      await pooled.close();
    }
  });
});

describe("invitation policy", () => {
  const invite = async (
    actor: string,
    orgId: string,
    email: string,
    role: "admin" | "member" | "viewer",
    hashSeed: string
  ) =>
    asPrincipal(actor, tx =>
      tx.query<{ id: string }>(
        `insert into aura.invitations (org_id, email, role, token_hash, invited_by, expires_at)
         values ($1,$2,$3,$4,$5, now() + interval '2 days') returning id`,
        [orgId, email, role, Buffer.from(hashSeed.padEnd(64, "0"), "hex"), actor]
      )
    );

  it("lets an owner invite a member and blocks an admin from inviting an admin", async () => {
    const created = await invite(OWNER_A, ORG_A, "new-member@example.test", "member", "11");
    expect(created[0]?.id).toBeTruthy();

    await expects(
      invite(ADMIN_A, ORG_A, "second-admin@example.test", "admin", "22"),
      /row-level security|permission denied/i
    );
  });

  it("prevents duplicate pending invitations and cross-tenant invitation reads", async () => {
    await invite(OWNER_A, ORG_A, "duplicate@example.test", "member", "33");
    await expects(
      invite(OWNER_A, ORG_A, "duplicate@example.test", "member", "44"),
      /duplicate key|unique/i
    );
    const fromB = await asPrincipal(OWNER_B, tx =>
      tx.query(`select id from aura.invitations where org_id = $1`, [ORG_A])
    );
    expect(fromB).toEqual([]);
  });

  it("binds acceptance to the invited address and allows a single use", async () => {
    await admin.query(
      `insert into aura.principals (id, issuer, subject, email) values
        ('77777777-7777-4777-8777-777777777777','local','invitee','invitee@example.test'),
        ('88888888-8888-4888-8888-888888888888','local','other','other@example.test')`
    );
    const tokenHash = Buffer.from("aa".repeat(32), "hex");
    const created = await asPrincipal(OWNER_A, tx =>
      tx.query<{ id: string }>(
        `insert into aura.invitations (org_id, email, role, token_hash, invited_by, expires_at)
         values ($1,'invitee@example.test','member',$2,$3, now() + interval '1 day') returning id`,
        [ORG_A, tokenHash, OWNER_A]
      )
    );
    expect(created).toHaveLength(1);

    await expects(
      asPrincipal(
        "88888888-8888-4888-8888-888888888888",
        tx => tx.query(`select * from aura.accept_invitation($1::bytea)`, [tokenHash])
      ),
      /invitation_email_mismatch/
    );
    const accepted = await asPrincipal(
      "77777777-7777-4777-8777-777777777777",
      tx => tx.query(`select * from aura.accept_invitation($1::bytea)`, [tokenHash])
    );
    expect(accepted).toHaveLength(1);

    await expects(
      asPrincipal(
        "77777777-7777-4777-8777-777777777777",
        tx => tx.query(`select * from aura.accept_invitation($1::bytea)`, [tokenHash])
      ),
      /already_accepted/
    );
  });

  it("refuses expired and revoked invitations", async () => {
    for (const variant of ["expired", "revoked"] as const) {
      const email = `${variant}-invite@example.test`;
      const tokenBytes = Buffer.from(variant === "expired" ? "ee".repeat(32) : "dd".repeat(32), "hex");
      const created = await asPrincipal(OWNER_A, tx =>
        variant === "expired"
          ? tx.query<{ id: string; org_id: string }>(
              `insert into aura.invitations
                 (org_id, email, role, token_hash, invited_by, created_at, expires_at)
               values ($1,$2,'member',$3,$4, now() - interval '2 days', now() - interval '1 day')
               returning id, org_id`,
              [ORG_A, email, tokenBytes, OWNER_A]
            )
          : tx.query<{ id: string; org_id: string }>(
              `insert into aura.invitations (org_id, email, role, token_hash, invited_by, expires_at)
               values ($1,$2,'member',$3,$4, now() + interval '1 day') returning id, org_id`,
              [ORG_A, email, tokenBytes, OWNER_A]
            )
      );
      const id = created[0]?.id ?? "";
      if (variant === "revoked")
        await asPrincipal(OWNER_A, tx =>
          tx.query(`update aura.invitations set revoked_at = now() where id = $1`, [id])
        );

      const principalId =
        variant === "expired"
          ? "66666666-6666-4666-8666-666666666666"
          : "55555555-5555-4555-8555-555555555555";
      await admin.query(
        `insert into aura.principals (id, issuer, subject, email) values ($1,'local',$2,$3)
         on conflict (id) do nothing`,
        [principalId, variant, email]
      );
      await expects(
        asPrincipal(principalId, tx =>
          tx.query(`select * from aura.accept_invitation($1::bytea)`, [tokenBytes])
        ),
        variant === "expired" ? /invitation_expired/ : /invitation_revoked/
      );
    }
  });
});

describe("role escalation prevention", () => {
  it("refuses a member or viewer that tries to change roles", async () => {
    await expects(
      asPrincipal(MEMBER_A, tx =>
        tx.query(`select * from aura.set_member_role($1,$2,'owner')`, [ORG_A, MEMBER_A])
      ),
      /forbidden/
    );
    await expects(
      asPrincipal(VIEWER_A, tx =>
        tx.query(`select * from aura.set_member_role($1,$2,'admin')`, [ORG_A, VIEWER_A])
      ),
      /forbidden/
    );
  });

  it("stops an admin from granting ownership", async () => {
    await expects(
      asPrincipal(ADMIN_A, tx =>
        tx.query(`select * from aura.set_member_role($1,$2,'owner')`, [ORG_A, MEMBER_A])
      ),
      /forbidden/
    );
  });

  it("keeps at least one active owner", async () => {
    await expects(
      asPrincipal(OWNER_A, tx =>
        tx.query(`select * from aura.set_member_role($1,$2,'member')`, [ORG_A, OWNER_A])
      ),
      /last_owner/
    );
    await expects(
      asPrincipal(OWNER_A, tx =>
        tx.query(`select * from aura.revoke_membership($1,$2)`, [ORG_A, OWNER_A])
      ),
      /last_owner/
    );
    const owners = await admin.query<{ count: number }>(
      `select count(*)::int as count from aura.memberships
        where org_id = $1 and role = 'owner' and status = 'active'`,
      [ORG_A]
    );
    expect(owners[0]?.count).toBe(1);
  });

  it("lets an owner change another member role and records the change", async () => {
    const updated = await asPrincipal(OWNER_A, tx =>
      tx.query<{ role: string }>(
        `select role from aura.set_member_role($1,$2,'admin')`,
        [ORG_A, MEMBER_A]
      )
    );
    expect(updated[0]?.role).toBe("admin");
    // Restore so later expectations stay independent of ordering assumptions.
    await asPrincipal(OWNER_A, tx =>
      tx.query(`select role from aura.set_member_role($1,$2,'member')`, [ORG_A, MEMBER_A])
    );
  });

  it("does not let the runtime role escalate its own SQL privileges", async () => {
    await expects(db.query(`create role escalation_attempt`), /permission denied/i);
    const privileged = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `select r.rolsuper, r.rolbypassrls from pg_roles r where r.rolname = current_user`
    );
    expect(privileged).toEqual([{ rolsuper: false, rolbypassrls: false }]);
  });
});

describe("membership administration views", () => {
  it("exposes member lists only to owners and admins", async () => {
    const asOwner = await asPrincipal(OWNER_A, tx =>
      tx.query(`select email from aura.org_members($1)`, [ORG_A])
    );
    expect(asOwner.length).toBeGreaterThanOrEqual(4);
    const asViewer = await asPrincipal(VIEWER_A, tx =>
      tx.query(`select email from aura.org_members($1)`, [ORG_A])
    );
    expect(asViewer).toEqual([]);
  });
});
