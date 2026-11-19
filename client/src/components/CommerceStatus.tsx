import type { ReactNode } from "react";

/** Informational only. Never hydrate identity, order or payment data here. */
export function CommerceStatus({
  section,
  title,
  children,
  href = "/catalog",
  link = "Explore catalog",
}: {
  section: string;
  title: string;
  children: ReactNode;
  href?: string;
  link?: string;
}) {
  return (
    <div className="commerce-page">
      <header className="commerce-header">
        <a className="wordmark" href="/">
          HOLO
        </a>
      </header>
      <main className="checkout-main page-shell">
        <div className="checkout-heading">
          <span className="mono-label">HOLO / {section}</span>
          <h1>{title}</h1>
        </div>
        <div className="checkout-form">
          {children}
          <a className="button button--primary" href={href}>
            {link}
          </a>
        </div>
      </main>
    </div>
  );
}
