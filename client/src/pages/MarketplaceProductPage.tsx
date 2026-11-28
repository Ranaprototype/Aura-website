import { useEffect, useState } from "react";
import type { PublicProductDetail } from "../../../shared/storefront";
import { storefront } from "../lib/storefront";
import { CommerceStatus } from "../components/CommerceStatus";

/**
 * Phase 4 anonymous product detail. Renders only the D-02 discovery allowlist
 * (no internal ids, no seller identity). A legacy slug that redirects to a live
 * product replaces the URL with the canonical slug so links stay predictable.
 */
export default function MarketplaceProductPage({ slug }: { slug: string }) {
  const [product, setProduct] = useState<PublicProductDetail>();
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">(
    "loading"
  );

  useEffect(() => {
    let active = true;
    setStatus("loading");
    void storefront.detail(slug).then(result => {
      if (!active) return;
      if (result.status === 404) {
        setStatus("missing");
        return;
      }
      if (!result.ok || !result.data) {
        setStatus("error");
        return;
      }
      // Live-first redirect: replace the address with the canonical slug.
      if (result.data.redirectedFrom && result.data.canonicalSlug) {
        window.history.replaceState(
          {},
          "",
          `/marketplace/product/${result.data.canonicalSlug}`
        );
      }
      setProduct(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [slug]);

  if (status === "loading")
    return (
      <main className="checkout-main page-shell">
        <p role="status" data-testid="marketplace-detail-loading">
          Loading product…
        </p>
      </main>
    );

  if (status === "missing")
    return (
      <CommerceStatus
        section="Marketplace"
        title="Product not found."
        href="/marketplace"
        link="Back to marketplace"
      >
        <p>This product is not published or the address is incorrect.</p>
      </CommerceStatus>
    );

  if (status === "error" || !product)
    return (
      <CommerceStatus
        section="Marketplace"
        title="Temporarily unavailable."
        href="/marketplace"
        link="Back to marketplace"
      >
        <p>The storefront could not be reached. Please try again shortly.</p>
      </CommerceStatus>
    );

  return (
    <div className="commerce-page">
      <header className="commerce-header">
        <a className="wordmark" href="/">
          HOLO
        </a>
        <nav className="marketplace-nav">
          <a href="/marketplace">Marketplace</a>
        </nav>
      </header>
      <main className="checkout-main page-shell" data-testid="marketplace-detail">
        <div className="checkout-heading">
          <span className="mono-label">HOLO / {product.category.name}</span>
          <h1>{product.title}</h1>
          {product.summary ? <p className="market-muted">{product.summary}</p> : null}
        </div>

        {product.media.length > 0 ? (
          <ul className="marketplace-media">
            {product.media.map(media => (
              <li key={`${media.url}-${media.position}`}>
                <img src={media.url} alt={media.altText ?? product.title} loading="lazy" />
              </li>
            ))}
          </ul>
        ) : null}

        {product.description ? (
          <section className="marketplace-section">
            <h2>About this product</h2>
            <p>{product.description}</p>
          </section>
        ) : null}

        {product.attributes.length > 0 ? (
          <section className="marketplace-section">
            <h2>Specifications</h2>
            <dl className="market-definitions" data-testid="marketplace-attributes">
              {product.attributes.map(attribute => (
                <div key={attribute.key}>
                  <dt>{attribute.label}</dt>
                  <dd>{attribute.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {product.variants.length > 0 ? (
          <section className="marketplace-section">
            <h2>Options</h2>
            <ul className="marketplace-variants" data-testid="marketplace-variants">
              {product.variants.map((variant, index) => (
                <li key={`${variant.title}-${index}`} className="market-panel">
                  <strong>{variant.title}</strong>
                  <span className="market-muted">
                    {[variant.size, variant.colour, variant.material]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <a className="button button--quiet" href="/marketplace">
          Back to marketplace
        </a>
      </main>
    </div>
  );
}
