import type { ReactNode } from "react";
import type { SessionInfo } from "../lib/api";

/**
 * HOLO shell for the seller and review surfaces.
 *
 * It keeps the storefront's type, palette and mono labelling while using the
 * light commerce surface the workspace already established. It is presentation
 * only: nothing here decides access.
 */
export function MarketplaceShell({
  session,
  orgId,
  onOrgChange,
  section,
  heading,
  intro,
  actions,
  children,
}: {
  session: SessionInfo;
  orgId?: string;
  onOrgChange?: (orgId: string) => void;
  section: string;
  heading: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const organizations = session.organizations ?? [];
  const signOut = async () => {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrf() ?? "" },
    });
    window.location.assign("/sign-in");
  };

  return (
    <div className="commerce-page">
      <header className="commerce-header">
        <a className="wordmark" href="/">
          HOLO
        </a>
        <nav className="market-nav" aria-label="Seller tools">
          <a href="/seller">Dashboard</a>
          <a href="/seller/products">Products</a>
          {session.platformAdmin ? <a href="/admin/review">Review</a> : null}
          <a href="/workspace">Workspace</a>
        </nav>
        <div>
          {organizations.length > 1 && orgId && onOrgChange ? (
            <label className="market-org">
              <span className="sr-only">Organization</span>
              <select
                value={orgId}
                onChange={event => onOrgChange(event.target.value)}
              >
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            className="market-button market-button--quiet"
            type="button"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="checkout-main page-shell">
        <div className="checkout-heading">
          <span className="mono-label">{section}</span>
          <h1>{heading}</h1>
          {intro ? <p className="market-intro">{intro}</p> : null}
        </div>
        {!session.principal?.emailVerified ? (
          <p role="alert" className="market-notice market-notice--warning">
            Confirm your email address to unlock seller actions.{" "}
            <a href="/workspace">Resend the verification email</a>.
          </p>
        ) : null}
        {actions ? <div className="market-toolbar">{actions}</div> : null}
        {children}
      </main>
    </div>
  );
}

const csrf = () => {
  const match = document.cookie.match(/(?:^|;\s*)aura_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
};
