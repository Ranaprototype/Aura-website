import { useCallback, useEffect, useMemo, useState } from "react";
import { MarketplaceShell } from "../components/MarketplaceShell";
import { MarketStatusBadge } from "../components/MarketStatusBadge";
import { useMarketplaceSession } from "../hooks/useMarketplaceSession";
import { explain, marketplace } from "../lib/marketplace";
import type {
  CategoryAttributeView,
  CategoryView,
  ProductDetailView,
} from "@shared/marketplace";

/**
 * Product management screen. Editing is a working-copy operation: it never
 * changes a stored approval, and edits to approved content require a new review
 * before the product can be sold.
 */
export default function SellerProductPage({
  productId,
}: {
  productId: string;
}) {
  const { session, orgId, setOrgId } = useMarketplaceSession();
  const [product, setProduct] = useState<ProductDetailView>();
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [draft, setDraft] = useState({
    title: "",
    summary: "",
    description: "",
  });
  const [attributeValues, setAttributeValues] = useState<
    Record<string, string>
  >({});
  const [variant, setVariant] = useState({
    sku: "",
    title: "",
    size: "",
    colour: "",
    material: "",
  });
  const [media, setMedia] = useState({ url: "", altText: "" });
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (org: string) => {
      const [detail, catalogue] = await Promise.all([
        marketplace.product(org, productId),
        marketplace.categories(org),
      ]);
      if (!detail.ok) {
        setError(explain(detail, "The product could not be loaded."));
        return;
      }
      setProduct(detail.data.product);
      setDraft({
        title: detail.data.product.title,
        summary: detail.data.product.summary ?? "",
        description: detail.data.product.description ?? "",
      });
      const values: Record<string, string> = {};
      for (const entry of detail.data.product.attributes)
        values[entry.attributeId] = entry.value;
      setAttributeValues(values);
      if (catalogue.ok) setCategories(catalogue.data.categories);
    },
    [productId]
  );

  useEffect(() => {
    if (orgId) void load(orgId);
  }, [orgId, load]);

  const category = useMemo(
    () => categories.find(entry => entry.id === product?.categoryId),
    [categories, product?.categoryId]
  );

  const run = async (
    action: () => Promise<{ ok: boolean; error?: string }>,
    success: string
  ) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await action();
    if (!result.ok) {
      setBusy(false);
      setError(explain(result, "That action did not complete."));
      if (orgId) await load(orgId);
      return;
    }
    // Refresh before announcing success: the success notice must never sit
    // beside a stale projection (for example "purchasable: yes" after an edit
    // that has already removed the product from that projection).
    if (orgId) await load(orgId);
    setBusy(false);
    setNotice(success);
  };

  const saveDetails = (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId) return;
    void run(
      () =>
        marketplace.updateProduct(orgId, productId, {
          title: draft.title,
          summary: draft.summary || null,
          description: draft.description || null,
        }),
      "Working copy saved."
    );
  };

  const saveAttributes = () => {
    if (!orgId || !category) return;
    const values = category.attributes
      .filter(attribute => (attributeValues[attribute.id] ?? "").length > 0)
      .map(attribute => ({
        attributeId: attribute.id,
        value: attributeValues[attribute.id]!,
      }));
    void run(
      () => marketplace.setAttributes(orgId, productId, values),
      "Category attributes saved."
    );
  };

  const addVariant = (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId) return;
    void run(
      () =>
        marketplace.addVariant(orgId, productId, {
          sku: variant.sku,
          title: variant.title,
          size: variant.size || null,
          colour: variant.colour || null,
          material: variant.material || null,
        }),
      "Variant added."
    ).then(() =>
      setVariant({ sku: "", title: "", size: "", colour: "", material: "" })
    );
  };

  const addMedia = (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId) return;
    void run(
      () =>
        marketplace.addMedia(orgId, productId, {
          url: media.url,
          altText: media.altText || null,
        }),
      "Media reference added."
    ).then(() => setMedia({ url: "", altText: "" }));
  };

  if (!session?.authenticated) {
    return (
      <main className="checkout-main page-shell">
        <p role="status">Sign in to continue.</p>
      </main>
    );
  }

  const canEdit = product?.permissions.canEdit ?? false;
  const canSubmit = product?.permissions.canSubmit ?? false;

  return (
    <MarketplaceShell
      session={session}
      orgId={orgId}
      onOrgChange={setOrgId}
      section="HOLO / Seller / Product"
      heading={product?.title ?? "Product"}
      intro={
        product
          ? "Submission snapshots exactly what you send. Approved content stays approved only until you edit it, then a new review is required."
          : undefined
      }
      actions={
        <a
          className="market-button market-button--quiet"
          href="/seller/products"
        >
          Back to catalogue
        </a>
      }
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

      {!product ? (
        <p role="status">Loading product…</p>
      ) : (
        <>
          <section className="market-panel" aria-labelledby="lifecycle-heading">
            <div className="market-panel__head">
              <h2 id="lifecycle-heading">Lifecycle</h2>
              <span data-testid="product-status">
                <MarketStatusBadge status={product.status} />
              </span>
            </div>
            <dl className="market-definitions">
              <div>
                <dt>Category</dt>
                <dd>{product.categoryName}</dd>
              </div>
              <div>
                <dt>Purchasable now</dt>
                <dd data-testid="purchasable">
                  {product.purchasable ? "yes" : "no"}
                </dd>
              </div>
              <div>
                <dt>Working copy</dt>
                <dd>
                  {product.pendingChanges
                    ? "edited since approval"
                    : product.status === "approved"
                      ? "matches the approved revision"
                      : "not approved"}
                </dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>{new Date(product.updatedAt).toLocaleString()}</dd>
              </div>
            </dl>
            <div className="market-actions">
              {canSubmit ? (
                <button
                  className="market-button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    orgId &&
                    run(
                      () => marketplace.submitProduct(orgId, productId),
                      "Submitted. The working copy is now frozen for review."
                    )
                  }
                  data-testid="submit-product"
                >
                  Submit for review
                </button>
              ) : null}
              {product.permissions.canArchive ? (
                <button
                  className="market-button market-button--quiet"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    orgId &&
                    run(
                      () => marketplace.archiveProduct(orgId, productId),
                      "Product archived. It remains read-only in the history."
                    )
                  }
                  data-testid="archive-product"
                >
                  Archive product
                </button>
              ) : null}
              {!canEdit ? (
                <span className="market-muted">
                  Editing is disabled while this product is {product.status}.
                </span>
              ) : null}
            </div>
          </section>

          <div className="market-columns">
            <section className="market-panel" aria-labelledby="details-heading">
              <div className="market-panel__head">
                <h2 id="details-heading">Details</h2>
              </div>
              <form className="market-form" onSubmit={saveDetails}>
                <p className="market-field">
                  <label htmlFor="edit-title">Title</label>
                  <input
                    id="edit-title"
                    className="market-input"
                    value={draft.title}
                    required
                    disabled={!canEdit}
                    onChange={event =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                  />
                </p>
                <p className="market-field">
                  <label htmlFor="edit-summary">Summary</label>
                  <input
                    id="edit-summary"
                    className="market-input"
                    value={draft.summary}
                    maxLength={300}
                    disabled={!canEdit}
                    onChange={event =>
                      setDraft({ ...draft, summary: event.target.value })
                    }
                  />
                </p>
                <p className="market-field">
                  <label htmlFor="edit-description">Description</label>
                  <textarea
                    id="edit-description"
                    className="market-input"
                    rows={6}
                    maxLength={5000}
                    value={draft.description}
                    disabled={!canEdit}
                    onChange={event =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                  />
                </p>
                <div className="market-actions">
                  <button
                    className="market-button"
                    type="submit"
                    disabled={!canEdit || busy}
                  >
                    Save working copy
                  </button>
                </div>
              </form>
            </section>

            <section
              className="market-panel"
              aria-labelledby="attributes-heading"
            >
              <div className="market-panel__head">
                <h2 id="attributes-heading">Category attributes</h2>
                <span className="market-muted">
                  {category?.name ?? product.categoryName}
                </span>
              </div>
              {category?.attributes.length ? (
                <>
                  <div className="market-form">
                    {category.attributes.map(attribute => (
                      <AttributeField
                        key={attribute.id}
                        attribute={attribute}
                        value={attributeValues[attribute.id] ?? ""}
                        disabled={!canEdit}
                        onChange={value =>
                          setAttributeValues(current => ({
                            ...current,
                            [attribute.id]: value,
                          }))
                        }
                      />
                    ))}
                  </div>
                  <div className="market-actions">
                    <button
                      className="market-button"
                      type="button"
                      disabled={!canEdit || busy}
                      onClick={saveAttributes}
                    >
                      Save attributes
                    </button>
                  </div>
                </>
              ) : (
                <p className="market-muted">
                  This category defines no attributes.
                </p>
              )}
            </section>
          </div>

          <div className="market-columns">
            <section
              className="market-panel"
              aria-labelledby="variants-heading"
            >
              <div className="market-panel__head">
                <h2 id="variants-heading">Variants</h2>
                <span className="market-muted" data-testid="variant-count">
                  {product.variants.length}
                </span>
              </div>
              <ul className="market-simple-list" data-testid="variant-list">
                {product.variants.map(entry => (
                  <li key={entry.id}>
                    <span>
                      <strong>{entry.sku}</strong> · {entry.title}
                      {entry.size ? ` · ${entry.size}` : ""}
                      {entry.colour ? ` · ${entry.colour}` : ""}
                      {entry.material ? ` · ${entry.material}` : ""}
                    </span>
                    {canEdit ? (
                      <button
                        className="market-link-button"
                        type="button"
                        onClick={() =>
                          orgId &&
                          run(
                            () =>
                              marketplace.deleteVariant(
                                orgId,
                                productId,
                                entry.id
                              ),
                            "Variant removed."
                          )
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
                {product.variants.length === 0 ? (
                  <li>No variants yet.</li>
                ) : null}
              </ul>
              {canEdit ? (
                <form
                  className="market-form market-form--inline"
                  onSubmit={addVariant}
                >
                  <p className="market-field">
                    <label htmlFor="variant-sku">SKU</label>
                    <input
                      id="variant-sku"
                      className="market-input"
                      required
                      value={variant.sku}
                      onChange={event =>
                        setVariant({ ...variant, sku: event.target.value })
                      }
                    />
                  </p>
                  <p className="market-field">
                    <label htmlFor="variant-title">Title</label>
                    <input
                      id="variant-title"
                      className="market-input"
                      required
                      value={variant.title}
                      onChange={event =>
                        setVariant({ ...variant, title: event.target.value })
                      }
                    />
                  </p>
                  <p className="market-field">
                    <label htmlFor="variant-size">Size</label>
                    <input
                      id="variant-size"
                      className="market-input"
                      value={variant.size}
                      onChange={event =>
                        setVariant({ ...variant, size: event.target.value })
                      }
                    />
                  </p>
                  <p className="market-field">
                    <label htmlFor="variant-colour">Colour</label>
                    <input
                      id="variant-colour"
                      className="market-input"
                      value={variant.colour}
                      onChange={event =>
                        setVariant({ ...variant, colour: event.target.value })
                      }
                    />
                  </p>
                  <p className="market-field">
                    <label htmlFor="variant-material">Material</label>
                    <input
                      id="variant-material"
                      className="market-input"
                      value={variant.material}
                      onChange={event =>
                        setVariant({ ...variant, material: event.target.value })
                      }
                    />
                  </p>
                  <button
                    className="market-button"
                    type="submit"
                    disabled={busy}
                  >
                    Add variant
                  </button>
                </form>
              ) : null}
            </section>

            <section className="market-panel" aria-labelledby="media-heading">
              <div className="market-panel__head">
                <h2 id="media-heading">Media references</h2>
                <span className="market-muted" data-testid="media-count">
                  {product.media.length}
                </span>
              </div>
              <p className="market-muted">
                External https references only. This phase stores the reference,
                not the file.
              </p>
              <ul className="market-simple-list">
                {product.media.map(entry => (
                  <li key={entry.id}>
                    <span className="market-media-url">{entry.url}</span>
                    {canEdit ? (
                      <button
                        className="market-link-button"
                        type="button"
                        onClick={() =>
                          orgId &&
                          run(
                            () =>
                              marketplace.deleteMedia(
                                orgId,
                                productId,
                                entry.id
                              ),
                            "Media reference removed."
                          )
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </li>
                ))}
                {product.media.length === 0 ? (
                  <li>No media references yet.</li>
                ) : null}
              </ul>
              {canEdit ? (
                <form className="market-form" onSubmit={addMedia}>
                  <p className="market-field">
                    <label htmlFor="media-url">https image URL</label>
                    <input
                      id="media-url"
                      className="market-input"
                      required
                      value={media.url}
                      onChange={event =>
                        setMedia({ ...media, url: event.target.value })
                      }
                    />
                  </p>
                  <p className="market-field">
                    <label htmlFor="media-alt">Alt text</label>
                    <input
                      id="media-alt"
                      className="market-input"
                      value={media.altText}
                      onChange={event =>
                        setMedia({ ...media, altText: event.target.value })
                      }
                    />
                  </p>
                  <button
                    className="market-button"
                    type="submit"
                    disabled={busy}
                  >
                    Add media
                  </button>
                </form>
              ) : null}
            </section>
          </div>

          <div className="market-columns">
            <section
              className="market-panel"
              aria-labelledby="revisions-heading"
            >
              <div className="market-panel__head">
                <h2 id="revisions-heading">Review history</h2>
              </div>
              {product.revisions.length === 0 ? (
                <p className="market-muted">Nothing submitted yet.</p>
              ) : (
                <ol className="market-activity" data-testid="revision-list">
                  {product.revisions.map(revision => (
                    <li key={revision.id}>
                      <span className="mono-label">
                        rev {revision.revisionNumber}
                      </span>
                      <span>{revision.decision}</span>
                      <span className="market-muted">
                        {revision.reviewedAt
                          ? `reviewed ${new Date(revision.reviewedAt).toLocaleString()}`
                          : `submitted ${new Date(revision.submittedAt).toLocaleString()}`}
                      </span>
                      {revision.reviewNote ? (
                        <em>“{revision.reviewNote}”</em>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="market-panel" aria-labelledby="audit-heading">
              <div className="market-panel__head">
                <h2 id="audit-heading">Audit trail</h2>
                <span className="market-muted">append-only</span>
              </div>
              <ol className="market-activity" data-testid="audit-list">
                {product.audit.map(event => (
                  <li key={event.id}>
                    <span className="mono-label">{event.action}</span>
                    <span>{event.actorName ?? "system"}</span>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </MarketplaceShell>
  );
}

function AttributeField({
  attribute,
  value,
  disabled,
  onChange,
}: {
  attribute: CategoryAttributeView;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <p className="market-field">
      <label htmlFor={`attribute-${attribute.key}`}>
        {attribute.label}
        {attribute.isRequired ? " *" : ""}
      </label>
      {attribute.dataType === "select" ? (
        <select
          id={`attribute-${attribute.key}`}
          className="market-input"
          value={value}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
        >
          <option value="">Not set</option>
          {(attribute.options ?? []).map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : attribute.dataType === "boolean" ? (
        <select
          id={`attribute-${attribute.key}`}
          className="market-input"
          value={value}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
        >
          <option value="">Not set</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          id={`attribute-${attribute.key}`}
          className="market-input"
          value={value}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
        />
      )}
    </p>
  );
}
