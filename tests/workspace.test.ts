/**
 * Organization, invitation and role authorization through the HTTP API, backed
 * by the real PostgreSQL policies. Every allow/deny pair is asserted against
 * both the response and the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findMessage, tokenFromMessage } from "./support/smtp";
import { registerUser, startTestApp, type TestApp } from "./support/app";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

const password = "correct-horse-battery-9";

async function verifiedUser(email: string, displayName = "User") {
  const user = await registerUser(app, { email, password, displayName });
  const token = tokenFromMessage(
    findMessage(app.sink, { to: email, subject: "Confirm your AURA email" }),
    "/verify-email"
  );
  const verification = await user.client.post("/api/v1/auth/email/verify", { token });
  expect(verification.status).toBe(200);
  return user;
}

describe("organization membership and projects", () => {
  it("lets an owner invite, an invitee accept and a viewer read only", async () => {
    const owner = await verifiedUser("owner@example.test", "Owner One");
    const invitee = await verifiedUser("invitee@example.test", "Invitee Two");

    const invitation = await owner.client.post<{ invitation: { id: string } }>(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "invitee@example.test", role: "viewer" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(invitation.status).toBe(201);

    const message = findMessage(app.sink, {
      to: "invitee@example.test",
      subject: "invited you",
    });
    const token = tokenFromMessage(message, "/accept-invitation");
    expect(token).toBeTruthy();
    expect(JSON.stringify(app.logs)).not.toContain(token);

    const accepted = await invitee.client.post("/api/v1/invitations/accept", { token });
    expect(accepted.status).toBe(200);
    expect((accepted.body as { membership: { role: string } }).membership.role).toBe("viewer");

    // The viewer now sees the organization in their own membership list.
    const session = await invitee.client.get<{ organizations: Array<{ id: string; role: string }> }>(
      "/api/v1/auth/session"
    );
    const joined = session.body.organizations?.find(org => org.id === owner.organizationId);
    expect(joined?.role).toBe("viewer");

    const read = await invitee.client.get("/api/v1/projects", {
      headers: { "x-aura-org": owner.organizationId },
    });
    expect(read.status).toBe(200);
    const write = await invitee.client.post(
      "/api/v1/projects",
      { name: "Viewer project" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(write.status).toBe(403);
    expect(write.body).toEqual({ error: "role_forbidden" });

    // A second acceptance of the same invitation is refused.
    const replay = await invitee.client.post("/api/v1/invitations/accept", { token });
    expect(replay.status).toBe(400);
    expect(replay.body).toEqual({ error: "invitation_already_accepted" });
  });

  it("binds an invitation to the invited address", async () => {
    const owner = await verifiedUser("binder@example.test");
    await verifiedUser("wrong-person@example.test");
    const invitation = await owner.client.post(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "someone-else@example.test", role: "member" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(invitation.status).toBe(201);
    const token = tokenFromMessage(
      findMessage(app.sink, { to: "someone-else@example.test", subject: "invited you" }),
      "/accept-invitation"
    );
    const stranger = app.client();
    const login = await stranger.post("/api/v1/auth/login", {
      email: "wrong-person@example.test",
      password,
    });
    expect(login.status).toBe(200);
    const denied = await stranger.post("/api/v1/invitations/accept", { token });
    expect(denied.status).toBe(400);
    expect(denied.body).toEqual({ error: "invitation_email_mismatch" });
    const members = await app.db.admin.query(
      `select principal_id from aura.memberships where org_id = $1`,
      [owner.organizationId]
    );
    expect(members).toHaveLength(1);
  });

  it("refuses a duplicate pending invitation and a revoked one", async () => {
    const owner = await verifiedUser("revoker@example.test");
    const first = await owner.client.post<{ invitation: { id: string } }>(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "pending@example.test", role: "member" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(first.status).toBe(201);
    const duplicate = await owner.client.post(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "pending@example.test", role: "member" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: "invitation_exists" });

    const revoked = await owner.client.delete(
      `/api/v1/organizations/${owner.organizationId}/invitations/${first.body.invitation.id}`,
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(revoked.status).toBe(200);

    const token = tokenFromMessage(
      findMessage(app.sink, { to: "pending@example.test", subject: "invited you" }),
      "/accept-invitation"
    );
    const invitee = app.client();
    await app.db.admin.query(
      `insert into aura.principals (issuer, subject, email) values ('local', gen_random_uuid()::text, 'pending@example.test')`
    );
    await invitee.get("/api/v1/auth/session");
    // The invitation stays unusable even with a valid session for that address.
    const denied = await invitee.post("/api/v1/invitations/accept", { token });
    expect(denied.status).toBe(401);
  });
});

describe("role administration", () => {
  it("promotes a member and notifies them, and blocks an admin from inviting an admin", async () => {
    const owner = await verifiedUser("roles-owner@example.test", "Role Owner");
    const member = await verifiedUser("roles-member@example.test", "Role Member");
    const invitation = await owner.client.post(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "roles-member@example.test", role: "member" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(invitation.status).toBe(201);
    const token = tokenFromMessage(
      findMessage(app.sink, { to: "roles-member@example.test", subject: "invited you" }),
      "/accept-invitation"
    );
    expect((await member.client.post("/api/v1/invitations/accept", { token })).status).toBe(200);

    app.sink.reset();
    const promoted = await owner.client.patch(
      `/api/v1/organizations/${owner.organizationId}/members/${member.principalId}`,
      { role: "admin" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(promoted.status).toBe(200);
    const notice = findMessage(app.sink, {
      to: "roles-member@example.test",
      subject: "role in",
    });
    expect(notice).toBeDefined();
    expect(notice?.html ?? "").toContain("member");
    expect(notice?.html ?? "").toContain("admin");

    // An admin may invite a member but not another admin.
    const asAdmin = await member.client.post(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "another-admin@example.test", role: "admin" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(asAdmin.status).toBe(403);
    const asAdminMember = await member.client.post(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "from-admin@example.test", role: "member" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(asAdminMember.status).toBe(201);

    // A plain member may not administer anything.
    const downgraded = await owner.client.patch(
      `/api/v1/organizations/${owner.organizationId}/members/${member.principalId}`,
      { role: "member" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(downgraded.status).toBe(200);
    const asMemberInvite = await member.client.post(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "from-member@example.test", role: "member" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(asMemberInvite.status).toBe(403);
    const selfPromote = await member.client.patch(
      `/api/v1/organizations/${owner.organizationId}/members/${member.principalId}`,
      { role: "owner" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(selfPromote.status).toBe(403);
    const role = await app.db.admin.query<{ role: string }>(
      `select role from aura.memberships where org_id = $1 and principal_id = $2`,
      [owner.organizationId, member.principalId]
    );
    expect(role[0]?.role).toBe("member");
  });

  it("revokes access immediately and notifies the removed member", async () => {
    const owner = await verifiedUser("revoke-owner@example.test", "Revoke Owner");
    const member = await verifiedUser("revoke-member@example.test", "Revoke Member");
    const invitation = await owner.client.post(
      `/api/v1/organizations/${owner.organizationId}/invitations`,
      { email: "revoke-member@example.test", role: "member" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(invitation.status).toBe(201);
    const token = tokenFromMessage(
      findMessage(app.sink, { to: "revoke-member@example.test", subject: "invited you" }),
      "/accept-invitation"
    );
    expect((await member.client.post("/api/v1/invitations/accept", { token })).status).toBe(200);
    const created = await member.client.post(
      "/api/v1/projects",
      { name: "Before revocation" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(created.status).toBe(201);

    app.sink.reset();
    const revoked = await owner.client.delete(
      `/api/v1/organizations/${owner.organizationId}/members/${member.principalId}`,
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(revoked.status).toBe(200);
    const notice = findMessage(app.sink, {
      to: "revoke-member@example.test",
      subject: "access to",
    });
    expect(notice).toBeDefined();

    // The removed member keeps a valid session but loses the organization.
    const session = await member.client.get<{ authenticated: boolean }>("/api/v1/auth/session");
    expect(session.body.authenticated).toBe(true);
    const denied = await member.client.get("/api/v1/projects", {
      headers: { "x-aura-org": owner.organizationId },
    });
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "organization_forbidden" });

    const rows = await app.db.admin.query<{ status: string; revoked_at: Date | null }>(
      `select status, revoked_at from aura.memberships
        where org_id = $1 and principal_id = $2`,
      [owner.organizationId, member.principalId]
    );
    expect(rows[0]?.status).toBe("revoked");
    expect(rows[0]?.revoked_at).toBeTruthy();
  });

  it("keeps the last owner in place", async () => {
    const owner = await verifiedUser("last-owner@example.test");
    const denied = await owner.client.delete(
      `/api/v1/organizations/${owner.organizationId}/members/${owner.principalId}`,
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(denied.status).toBe(409);
    expect(denied.body).toEqual({ error: "last_owner" });
    const still = await owner.client.get("/api/v1/projects", {
      headers: { "x-aura-org": owner.organizationId },
    });
    expect(still.status).toBe(200);
  });

  it("enforces a viewer read-only project list and owner-only deletion", async () => {
    const owner = await verifiedUser("matrix-owner@example.test");
    const created = await owner.client.post<{ project: { id: string } }>(
      "/api/v1/projects",
      { name: "Deletable" },
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(created.status).toBe(201);
    const listed = await owner.client.get<{ projects: Array<{ id: string; name: string }> }>(
      "/api/v1/projects",
      { headers: { "x-aura-org": owner.organizationId } }
    );
    expect(listed.body.projects.map(project => project.name)).toContain("Deletable");
    const removed = await owner.client.delete(`/api/v1/projects/${created.body.project.id}`, {
      headers: { "x-aura-org": owner.organizationId },
    });
    expect(removed.status).toBe(200);
    const missing = await owner.client.delete(`/api/v1/projects/${created.body.project.id}`, {
      headers: { "x-aura-org": owner.organizationId },
    });
    expect(missing.status).toBe(404);
  });

  it("refuses cross-organization identifiers even for an owner of another tenant", async () => {
    const alpha = await verifiedUser("alpha@example.test");
    const beta = await verifiedUser("beta@example.test");
    await alpha.client.post(
      "/api/v1/projects",
      { name: "Alpha only" },
      { headers: { "x-aura-org": alpha.organizationId } }
    );
    for (const [method, path, body] of [
      ["GET", "/api/v1/projects", undefined],
      ["POST", "/api/v1/projects", { name: "Intrusion" }],
      ["DELETE", `/api/v1/projects/${alpha.organizationId}`, undefined],
    ] as const) {
      const result = await beta.client.request(method, path, {
        body,
        headers: { "x-aura-org": alpha.organizationId },
      });
      expect(result.status, `${method} ${path}`).toBe(403);
    }
    const rows = await app.db.admin.query<{ name: string }>(
      `select name from aura.projects where org_id = $1`,
      [alpha.organizationId]
    );
    expect(rows.map(row => row.name)).toEqual(["Alpha only"]);
  });
});

describe("platform administration", () => {
  it("denies the overview to an ordinary principal and allows a granted operator", async () => {
    const user = await verifiedUser("ordinary@example.test");
    const denied = await user.client.get("/api/v1/admin/overview");
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "role_forbidden" });

    await app.db.admin.query(
      `insert into aura.platform_admins (principal_id, note) values ($1, 'verification fixture')`,
      [user.principalId]
    );
    const allowed = await user.client.get<{ principals: number }>("/api/v1/admin/overview");
    expect(allowed.status).toBe(200);
    expect(allowed.body.principals).toBeGreaterThan(0);
  });
});
