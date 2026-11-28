import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_LIMIT,
  STOREFRONT_CATEGORIES,
  STOREFRONT_FACETS,
  type PublicProductSummary,
  type StorefrontSort,
} from "../../../shared/storefront";
import { storefront, type DiscoveryQuery } from "../lib/storefront";

/**
 * Phase 4 anonymous product discovery (D-22..D-25). Additive namespace under
 * /marketplace; it never shadows the HOLO preview configurators. Every filter
 * is re-applied server-side on the restricted public pool; this page only
 * shapes the request and renders the returned discovery allowlist.
 */
export default function MarketplacePage() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<DiscoveryQuery>({ sort: "newest" });
  const [items, setItems] = useState<PublicProductSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  // Sequence guard: rapid query changes (search, category, sort) each start a
  // fetch; only the latest request may apply its result, so a slow stale
  // response can never overwrite a newer one.
  const requestSeq = useRef(0);
  const loadFirstPage = useCallback(async (next: DiscoveryQuery) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(undefined);
    const result = await storefront.list({ ...next, limit: DEFAULT_LIMIT });
    if (seq !== requestSeq.current) return;
    setLoading(false);
    if (!result.ok || !result.data) {
      setError(
        result.error === "storefront_unavailable"
          ? "The storefront is temporarily unavailable. Please try again shortly."
          : "The catalogue could not be loaded."
      );
      setItems([]);
      setNextCursor(null);
      return;
    }
    setItems(result.data.items);
    setNextCursor(result.data.nextCursor);
  }, []);

  useEffect(() => {
    void loadFirstPage(query);
  }, [query, loadFirstPage]);

  const apply = (patch: Partial<DiscoveryQuery>) =>
    setQuery(current => ({ ...current, ...patch, cursor: null }));

  const toggleAttr = (entry: string) =>
    setQuery(current => {
      const attr = current.attr ?? [];
      return {
        ...current,
        cursor: null,
        attr: attr.includes(entry)
          ? attr.filter(value => value !== entry)
          : [...attr, entry],
      };
    });

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    const result = await storefront.list({
      ...query,
      limit: DEFAULT_LIMIT,
      cursor: nextCursor,
    });
    setLoadingMore(false);
    if (!result.ok || !result.data) {
      setError("No more products could be loaded.");
      return;
    }
    setItems(current => [...current, ...result.data!.items]);
    setNextCursor(result.data.nextCursor);
  };

  const activeAttr = query.attr ?? [];

  return (
    <div className="commerce-page">
      <header className="commerce-header">
        <a className="wordmark" href="/">
          HOLO
        </a>
        <nav className="marketplace-nav">
          <a href="/catalog">Preview store</a>
          <a href="/marketplace" aria-current="page">
            Marketplace
          </a>
        </nav>
      </header>
      <main className="checkout-main page-shell" id="marketplace-content">
        <div className="checkout-heading">
          <span className="mono-label">HOLO / Marketplace</span>
          <h1>Discover the catalogue</h1>
          <p className="market-muted">
            Browse published products from independent studios. Search by name,
            filter by category and material, and sort to suit you.
          </p>
        </div>

        <form
          className="marketplace-controls"
          role="search"
          onSubmit={event => {
            event.preventDefault();
            apply({ q: search.trim() || undefined });
          }}
        >
          <label className="marketplace-field">
            <span className="mono-label">Search</span>
            <input
              className="market-input"
              type="search"
              name="q"
              placeholder="Search titles and summaries"
              value={search}
              maxLength={100}
              data-testid="marketplace-search"
              onChange={event => setSearch(event.target.value)}
            />
          </label>
          <label className="marketplace-field">
            <span className="mono-label">Category</span>
            <select
              className="market-input"
              value={query.category ?? ""}
              data-testid="marketplace-category"
              onChange={event =>
                apply({ category: event.target.value || undefined })
              }
            >
              <option value="">All categories</option>
              {STOREFRONT_CATEGORIES.map(category => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="marketplace-field">
            <span className="mono-label">Sort</span>
            <select
              className="market-input"
              value={query.sort ?? "newest"}
              data-testid="marketplace-sort"
              onChange={event =>
                apply({ sort: event.target.value as StorefrontSort })
              }
            >
              <option value="newest">Newest first</option>
              <option value="title">Title A–Z</option>
            </select>
          </label>
          <button className="button button--primary" type="submit">
            Search
          </button>
        </form>

        <fieldset className="marketplace-facets">
          <legend className="mono-label">Refine by material</legend>
          {STOREFRONT_FACETS.map(facet => (
            <div key={facet.key} className="marketplace-facet">
              <span className="marketplace-facet__label">{facet.label}</span>
              {facet.options.map(option => {
                const entry = `${facet.key}:${option}`;
                return (
                  <label key={entry} className="marketplace-facet__option">
                    <input
                      type="checkbox"
                      checked={activeAttr.includes(entry)}
                      data-testid={`facet-${entry}`}
                      onChange={() => toggleAttr(entry)}
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          ))}
        </fieldset>

        {error ? (
          <p role="alert" className="market-notice market-notice--error" data-testid="marketplace-error">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p role="status" data-testid="marketplace-loading">
            Loading the catalogue…
          </p>
        ) : items.length === 0 ? (
          <p className="market-muted" data-testid="marketplace-empty">
            No published products match your filters.
          </p>
        ) : (
          <ul className="marketplace-grid" data-testid="marketplace-grid">
            {items.map(item => (
              <li key={item.slug} className="marketplace-card" data-testid="marketplace-card">
                <a href={`/marketplace/product/${item.slug}`}>
                  {item.heroImage ? (
                    <img
                      className="marketplace-card__image"
                      src={item.heroImage}
                      alt={item.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="marketplace-card__placeholder" aria-hidden="true" />
                  )}
                  <span className="mono-label">{item.category.name}</span>
                  <h2>{item.title}</h2>
                  {item.summary ? <p>{item.summary}</p> : null}
                </a>
              </li>
            ))}
          </ul>
        )}

        {nextCursor ? (
          <button
            className="button button--quiet"
            type="button"
            disabled={loadingMore}
            data-testid="marketplace-load-more"
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </main>
    </div>
  );
}
