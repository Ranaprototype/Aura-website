import { useCallback, useEffect, useState } from "react";
import { MarketplaceShell } from "../components/MarketplaceShell";
import { MarketStatusBadge } from "../components/MarketStatusBadge";
import { useMarketplaceSession } from "../hooks/useMarketplaceSession";
import { explain, marketplace } from "../lib/marketplace";
import type {
  CategoryView,
  ProductStatus,
  ProductSummaryView,
} from "@shared/marketplace";
import type { SellerProfileView } from "@shared/marketplace";
import { CATALOG_WRITE_ROLES } from "@shared/marketplace";

const statuses: Array<ProductStatus | "all"> = [
  "all",
  "draft",
  "submitted",
  "approved",
  "rejected",
  "archived",
];

/**
 * Product management list. Drafts are created here; editing, variants, media,
 * attributes and submission happen on the product screen.
 */
export default function SellerProductsPage() {
  const { session, orgId, setOrgId } = useMarketplaceSession();
  const [products, setProducts] = useState<ProductSummaryView[]>([]);
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [seller, setSeller] = useState<SellerProfileView | null>(null);
  const [filter, setFilter] = useState<ProductStatus | "all">("all");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const role = session?.organizations?.find(entry => entry.id === orgId)?.role;
  const canWrite = role
    ? (CATALOG_WRITE_ROLES as readonly string[]).includes(role)
    : false;

  const load = useCallback(
    async (org: string, status: ProductStatus | "all") => {
      const [list, catalogue, profile] = await Promise.all([
        marketplace.products(org, status === "all" ? undefined : status),
        marketplace.categories(org),
        marketplace.profile(org),
      ]);
      if (!list.ok) {
        setError(explain(list, "The product list could not be loaded."));
        return;
      }
      setProducts(list.data.products);
      if (catalogue.ok) {
        setCategories(catalogue.data.categories);
        setCategoryId(
          current => current || catalogue.data.categories[0]?.id || ""
        );
      }
      if (profile.ok) setSeller(profile.data.seller);
    },
    []
  );

  useEffect(() => {
    if (orgId) void load(orgId, filter);
  }, [orgId, filter, load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await marketplace.createProduct(orgId, {
      title,
      categoryId,
    });
    setBusy(false);
    if (!result.ok) {
      setError(explain(result, "The product draft was not created."));
      return;
    }
    setTitle("");
    setNotice("Draft created. Open it to add variants, media and attributes.");
    // Same in-app navigation the storefront router uses: no full reload.
    window.history.pushState(
      {},
      "",
      `/seller/products/${result.data.product.id}`
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  if (!session?.authenticated) {
    return (
      <main className="checkout-main page-shell">
        <p role="status">Sign in to continue.</p>
      </main>
    );
  }

  return (
    <MarketplaceShell
      session={session}
      orgId={orgId}
      onOrgChange={setOrgId}
      section="HOLO / Seller / Products"
      heading="Catalogue"
      intro="Drafts stay private. Submission freezes the working copy for review, and only an approved revision can be sold in a later commerce phase."
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

      {seller?.status === "approved" ? (
        canWrite ? (
          <section className="market-panel" aria-labelledby="create-heading">
            <div className="market-panel__head">
              <h2 id="create-heading">New product draft</h2>
            </div>
            <form className="market-form market-form--inline" onSubmit={create}>
              <p className="market-field">
                <label htmlFor="product-title">Product title</label>
                <input
                  id="product-title"
                  className="market-input"
                  value={title}
                  minLength={3}
                  maxLength={140}
                  required
                  onChange={event => setTitle(event.target.value)}
                />
              </p>
              <p className="market-field">
                <label htmlFor="product-category">Category</label>
                <select
                  id="product-category"
                  className="market-input"
                  value={categoryId}
                  required
                  onChange={event => setCategoryId(event.target.value)}
                >
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </p>
              <button
                className="market-button"
                type="submit"
                disabled={busy || !categoryId}
                data-testid="create-product"
              >
                Create draft
              </button>
            </form>
          </section>
        ) : (
          <p className="market-notice market-notice--warning" role="status">
            Your organization role can view the catalogue but not create
            products.
          </p>
        )
      ) : (
        <p className="market-notice market-notice--warning" role="status">
          {seller
            ? seller.status === "submitted"
              ? "Your seller application is awaiting review. Catalogue creation unlocks after approval."
              : "Your seller application must be approved before you can create products."
            : "Create a seller profile on the dashboard before creating products."}{" "}
          <a href="/seller">Go to the seller dashboard</a>.
        </p>
      )}

      <div className="market-toolbar">
        <label className="market-filter">
          <span className="mono-label">Status</span>
          <select
            className="market-input"
            value={filter}
            onChange={event =>
              setFilter(event.target.value as ProductStatus | "all")
            }
          >
            {statuses.map(status => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="market-panel" aria-labelledby="product-list-heading">
        <div className="market-panel__head">
          <h2 id="product-list-heading">Products</h2>
          <span className="market-muted">{products.length} shown</span>
        </div>
        {products.length === 0 ? (
          <p className="market-muted">No products in this view yet.</p>
        ) : (
          <ul className="market-product-list" data-testid="product-list">
            {products.map(product => (
              <li key={product.id}>
                <div>
                  <a href={`/seller/products/${product.id}`}>
                    <strong>{product.title}</strong>
                  </a>
                  <p className="market-muted">
                    {product.categoryName} · {product.variantCount} variant
                    {product.variantCount === 1 ? "" : "s"} ·{" "}
                    {product.mediaCount} media · updated{" "}
                    {new Date(product.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="market-product-list__meta">
                  <MarketStatusBadge status={product.status} />
                  {product.purchasable ? (
                    <span className="market-pill market-pill--live">
                      approved &amp; current
                    </span>
                  ) : product.pendingChanges ? (
                    <span className="market-pill">pending re-approval</span>
                  ) : null}
                  <a href={`/seller/products/${product.id}`}>Open</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </MarketplaceShell>
  );
}
