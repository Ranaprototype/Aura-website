import { useCallback, useEffect, useState } from "react";
import { api, loadSession, type SessionInfo } from "../lib/api";

interface Project {
  id: string;
  name: string;
  createdAt: string;
}

interface Member {
  principalId: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
}

/**
 * Protected workspace. The server refuses every call without an active session,
 * a bound organization and an active membership; this page only reflects that
 * decision, it never makes it.
 */
export default function WorkspacePage() {
  const [session, setSession] = useState<SessionInfo>();
  const [orgId, setOrgId] = useState<string>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(
    async (target?: string) => {
      const current = await loadSession();
      setSession(current);
      if (!current.authenticated) return;
      const organizations = current.organizations ?? [];
      const active = target ?? organizations[0]?.id;
      setOrgId(active);
      if (!active) {
        setProjects([]);
        setMembers([]);
        return;
      }
      const listed = await api<{ projects: Project[] }>("/projects", { org: active });
      setProjects(listed.ok ? (listed.data.projects ?? []) : []);
      const staff = await api<{ members: Member[] }>(`/organizations/${active}/members`, {
        org: active,
      });
      setMembers(staff.ok ? (staff.data.members ?? []) : []);
    },
    []
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const organizations = session?.organizations ?? [];
  const activeOrganization = organizations.find(org => org.id === orgId);
  const canWrite =
    activeOrganization?.role === "owner" ||
    activeOrganization?.role === "admin" ||
    activeOrganization?.role === "member";
  const canAdmin =
    activeOrganization?.role === "owner" || activeOrganization?.role === "admin";

  const resendVerification = async () => {
    const result = await api("/auth/email/resend", { method: "POST", body: {} });
    setNotice(result.ok ? "A new verification link has been sent." : undefined);
    setError(result.ok ? undefined : "Could not resend the verification email.");
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId) return;
    const result = await api("/projects", {
      method: "POST",
      body: { name },
      org: orgId,
    });
    if (!result.ok) {
      setError(`Project not created (${result.error ?? result.status}).`);
      return;
    }
    setError(undefined);
    setName("");
    await refresh(orgId);
  };

  const deleteProject = async (id: string) => {
    if (!orgId) return;
    const result = await api(`/projects/${id}`, { method: "DELETE", org: orgId });
    if (!result.ok) setError(`Project not removed (${result.error ?? result.status}).`);
    await refresh(orgId);
  };

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId) return;
    const result = await api(`/organizations/${orgId}/invitations`, {
      method: "POST",
      body: { email: inviteEmail, role: inviteRole },
      org: orgId,
    });
    if (!result.ok) {
      setError(`Invitation not created (${result.error ?? result.status}).`);
      return;
    }
    setNotice(`Invitation sent to ${inviteEmail}.`);
    setInviteEmail("");
  };

  const signOut = async () => {
    await api("/auth/logout", { method: "POST", body: {} });
    window.location.assign("/sign-in");
  };

  if (!session) {
    return (
      <main className="checkout-main page-shell" data-testid="workspace-loading">
        <p role="status">Loading your workspace…</p>
      </main>
    );
  }

  if (!session.authenticated) {
    // The server already denied the data request; this is only navigation.
    window.location.replace("/sign-in");
    return (
      <main className="checkout-main page-shell">
        <p role="status">Sign in to continue.</p>
      </main>
    );
  }

  return (
    <div className="commerce-page">
      <header className="commerce-header">
        <a className="wordmark" href="/">
          HOLO
        </a>
        <button className="button button--ghost" type="button" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main className="checkout-main page-shell">
        <div className="checkout-heading">
          <span className="mono-label">HOLO / Workspace</span>
          <h1 data-testid="workspace-heading">Your workspace</h1>
        </div>
        <div className="checkout-form">
          <p data-testid="signed-in-email">{session.principal?.email}</p>
          {session.principal?.emailVerified ? (
            <p role="status">Email verified.</p>
          ) : (
            <p role="alert" className="auth-status auth-status--info">
              Confirm your email address to unlock protected actions.{" "}
              <button className="button button--ghost" type="button" onClick={resendVerification}>
                Resend verification email
              </button>
            </p>
          )}
          {notice ? <p role="status">{notice}</p> : null}
          {error ? <p role="alert">{error}</p> : null}

          {organizations.length > 1 ? (
            <p className="auth-field">
              <label htmlFor="organization">Organization</label>
              <select
                id="organization"
                className="auth-input"
                value={orgId}
                onChange={event => {
                  void refresh(event.target.value);
                }}
              >
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name} ({org.role})
                  </option>
                ))}
              </select>
            </p>
          ) : null}

          <h2>Projects</h2>
          <ul data-testid="project-list">
            {projects.map(project => (
              <li key={project.id}>
                {project.name}
                {canAdmin ? (
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={() => deleteProject(project.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
            {projects.length === 0 ? <li>No projects yet.</li> : null}
          </ul>
          {canWrite ? (
            <form onSubmit={createProject}>
              <p className="auth-field">
                <label htmlFor="project-name">New project</label>
                <input
                  id="project-name"
                  className="auth-input"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  required
                />
              </p>
              <button className="button button--primary" type="submit">
                Create project
              </button>
            </form>
          ) : (
            <p role="status">Your role is read-only.</p>
          )}

          {canAdmin ? (
            <>
              <h2>Members</h2>
              <ul data-testid="member-list">
                {members.map(member => (
                  <li key={member.principalId}>
                    {member.email} — {member.role}
                  </li>
                ))}
              </ul>
              <form onSubmit={invite}>
                <p className="auth-field">
                  <label htmlFor="invite-email">Invite by email</label>
                  <input
                    id="invite-email"
                    type="email"
                    className="auth-input"
                    value={inviteEmail}
                    onChange={event => setInviteEmail(event.target.value)}
                    required
                  />
                </p>
                <p className="auth-field">
                  <label htmlFor="invite-role">Role</label>
                  <select
                    id="invite-role"
                    className="auth-input"
                    value={inviteRole}
                    onChange={event => setInviteRole(event.target.value)}
                  >
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                    <option value="admin">admin</option>
                  </select>
                </p>
                <button className="button button--primary" type="submit">
                  Send invitation
                </button>
              </form>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
