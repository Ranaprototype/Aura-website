import { useCallback, useEffect, useState } from "react";
import { MarketplaceShell } from "../components/MarketplaceShell";
import { MarketStatusBadge } from "../components/MarketStatusBadge";
import { useMarketplaceSession } from "../hooks/useMarketplaceSession";
import {
  explain,
  marketplace,
  type AdminProduct,
  type AdminSeller,
} from "../lib/marketplace";

type Tab = "sellers" | "products";

/**
 * Platform product-review interface.
 *
 * The queue is only reachable with the database-backed platform administrator
 * grant; this page renders the queue the server returned and never grants
 * itself anything. Approval decisions are recorded against the submitted
 * revision snapshot the reviewer can read here.
 */
export default function AdminReviewPage() {
  const { session, orgId, setOrgId } = useMarketplaceSession();
  const [tab, setTab] = useState<Tab>("sellers");
  const [sellers, setSellers] = useState<AdminSeller[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [detail, setDetail] = useState<AdminProduct>();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sellerQueue, productQueue] = await Promise.all([
      marketplace.adminSellers("submitted"),
      marketplace.adminProducts("submitted"),
    ]);
    if (!sellerQueue.ok) {
      setError(
        explain(sellerQueue, "The seller review queue could not be loaded.")
      );
      return;
    }
    setSellers(sellerQueue.data.sellers);
    if (productQueue.ok) setProducts(productQueue.data.products);
  }, []);

  useEffect(() => {
    if (session?.platformAdmin) void load();
  }, [session?.platformAdmin, load]);

  const act = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string
  ) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(explain(result, "That review action did not complete."));
      return;
    }
    setNotice(success);
    setDetail(undefined);
    await load();
  };

  const open = async (id: string) => {
    const result = await marketplace.adminProduct(id);
    if (!result.ok) {
      setError(explain(result, "The product could not be loaded."));
      return;
    }
    setDetail(result.data.product);
  };

  if (!session?.authenticated) {
    return (
      <main className="checkout-main page-shell">
        <p role="status">Sign in to continue.</p>
      </main>
    );
  }

  if (!session.platformAdmin) {
    return (
      <MarketplaceShell
        session={session}
        orgId={orgId}
        onOrgChange={setOrgId}
        section="HOLO / Platform review"
        heading="Review"
      >
        <p role="alert" className="market-notice market-notice--error">
          Platform administrator access is required. This queue is granted in
          the database, not by a browser role.
        </p>
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell
      session={session}
      orgId={orgId}
      onOrgChange={setOrgId}
      section="HOLO / Platform review"
      heading="Review queue"
      intro="Approve or reject seller applications and submitted catalogue revisions. Only approved revisions are purchasable in later commerce phases."
    >
      {error ? (
        <p role="alert" className="market-notice market-notice--error">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="market-notice market-notice--success">
          {notice}
        </p>
      ) : null}

      <div className="market-tabs" role="tablist" aria-label="Review queues">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sellers"}
          className={tab === "sellers" ? "is-active" : undefined}
          onClick={() => setTab("sellers")}
        >
          Sellers <span data-testid="seller-queue-count">{sellers.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "products"}
          className={tab === "products" ? "is-active" : undefined}
          onClick={() => setTab("products")}
        >
          Products{" "}
          <span data-testid="product-queue-count">{products.length}</span>
        </button>
      </div>

      {tab === "sellers" ? (
        sellers.length === 0 ? (
          <p className="market-muted" data-testid="seller-queue-empty">
            No seller applications are waiting for review.
          </p>
        ) : (
          <ul className="market-review-list" data-testid="seller-queue">
            {sellers.map(seller => (
              <li key={seller.id} className="market-panel">
                <div className="market-panel__head">
                  <h2>{seller.displayName}</h2>
                  <MarketStatusBadge status={seller.status} />
                </div>
                <dl className="market-definitions">
                  <div>
                    <dt>Organization</dt>
                    <dd>{seller.orgName}</dd>
                  </div>
                  <div>
                    <dt>Registered name</dt>
                    <dd>{seller.legalName}</dd>
                  </div>
                  <div>
                    <dt>Business email</dt>
                    <dd>{seller.businessEmail}</dd>
                  </div>
                  <div>
                    <dt>Country</dt>
                    <dd>{seller.country}</dd>
                  </div>
                  <div>
                    <dt>Submitted</dt>
                    <dd>
                      {seller.submittedAt
                        ? new Date(seller.submittedAt).toLocaleString()
                        : "—"}
                    </dd>
                  </div>
                </dl>
                {seller.description ? <p>{seller.description}</p> : null}
                {seller.website ? (
                  <p className="market-media-url">{seller.website}</p>
                ) : null}
                <div className="market-actions">
                  <button
                    className="market-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => marketplace.approveSeller(seller.orgId),
                        `${seller.displayName} is now an approved seller.`
                      )
                    }
                  >
                    Approve seller
                  </button>
                  <input
                    className="market-input market-input--note"
                    aria-label={`Rejection note for ${seller.displayName}`}
                    placeholder="Rejection note (required)"
                    value={notes[seller.orgId] ?? ""}
                    onChange={event =>
                      setNotes(current => ({
                        ...current,
                        [seller.orgId]: event.target.value,
                      }))
                    }
                  />
                  <button
                    className="market-button market-button--quiet"
                    type="button"
                    disabled={busy || !(notes[seller.orgId] ?? "").trim()}
                    onClick={() =>
                      act(
                        () =>
                          marketplace.rejectSeller(
                            seller.orgId,
                            notes[seller.orgId]!.trim()
                          ),
                        `${seller.displayName} was returned for changes.`
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : products.length === 0 ? (
        <p className="market-muted" data-testid="product-queue-empty">
          No product revisions are waiting for review.
        </p>
      ) : (
        <ul className="market-review-list" data-testid="product-queue">
          {products.map(product => (
            <li key={product.id} className="market-panel">
              <div className="market-panel__head">
                <h2>{product.title}</h2>
                <MarketStatusBadge status={product.status} />
              </div>
              <dl className="market-definitions">
                <div>
                  <dt>Seller</dt>
                  <dd>{product.orgName}</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{product.categoryName}</dd>
                </div>
                <div>
                  <dt>Variants</dt>
                  <dd>{product.variantCount}</dd>
                </div>
                <div>
                  <dt>Media</dt>
                  <dd>{product.mediaCount}</dd>
                </div>
              </dl>
              <div className="market-actions">
                <button
                  className="market-button market-button--quiet"
                  type="button"
                  onClick={() => open(product.id)}
                >
                  Review submitted copy
                </button>
                <button
                  className="market-button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => marketplace.approveProduct(product.id),
                      `${product.title} is approved.`
                    )
                  }
                >
                  Approve
                </button>
                <input
                  className="market-input market-input--note"
                  aria-label={`Rejection note for ${product.title}`}
                  placeholder="Rejection note (required)"
                  value={notes[product.id] ?? ""}
                  onChange={event =>
                    setNotes(current => ({
                      ...current,
                      [product.id]: event.target.value,
                    }))
                  }
                />
                <button
                  className="market-button market-button--quiet"
                  type="button"
                  disabled={busy || !(notes[product.id] ?? "").trim()}
                  onClick={() =>
                    act(
                      () =>
                        marketplace.rejectProduct(
                          product.id,
                          notes[product.id]!.trim()
                        ),
                      `${product.title} was returned to the seller.`
                    )
                  }
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {detail ? (
        <section
          className="market-panel"
          aria-labelledby="review-detail-heading"
        >
          <div className="market-panel__head">
            <h2 id="review-detail-heading">{detail.title}</h2>
            <button
              className="market-link-button"
              type="button"
              onClick={() => setDetail(undefined)}
            >
              Close
            </button>
          </div>
          <p>{detail.description ?? "No description supplied."}</p>
          <h3>Submitted revision</h3>
          <pre className="market-snapshot" data-testid="revision-snapshot">
            {JSON.stringify(detail.revisions?.[0]?.snapshot ?? {}, null, 2)}
          </pre>
          <div className="market-columns">
            <div>
              <h3>Variants</h3>
              <ul className="market-simple-list">
                {(detail.variants ?? []).map(entry => (
                  <li key={entry.id}>
                    <strong>{entry.sku}</strong> · {entry.title}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Attributes</h3>
              <ul className="market-simple-list">
                {(detail.attributes ?? []).map(entry => (
                  <li key={entry.key}>
                    {entry.label}: {entry.value}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="market-columns">
            <div>
              <h3>Media</h3>
              <ul className="market-simple-list">
                {(detail.media ?? []).map(entry => (
                  <li key={entry.id} className="market-media-url">
                    {entry.url}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>History</h3>
              <ol className="market-activity">
                {(detail.audit ?? []).map(event => (
                  <li key={event.id}>
                    <span className="mono-label">{event.action}</span>
                    <span>{event.actorName ?? "system"}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      ) : null}
    </MarketplaceShell>
  );
}
