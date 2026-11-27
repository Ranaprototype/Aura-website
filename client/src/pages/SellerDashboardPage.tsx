import { useCallback, useEffect, useState } from "react";
import { MarketplaceShell } from "../components/MarketplaceShell";
import { MarketStatusBadge } from "../components/MarketStatusBadge";
import { useMarketplaceSession } from "../hooks/useMarketplaceSession";
import {
  explain,
  marketplace,
  type SellerDashboard,
  type SellerInput,
} from "../lib/marketplace";
import type { SellerProfileView } from "@shared/marketplace";

const emptyForm: SellerInput = {
  displayName: "",
  legalName: "",
  businessEmail: "",
  country: "IN",
  website: "",
  description: "",
};

const fromSeller = (seller: SellerProfileView | null): SellerInput =>
  seller
    ? {
        displayName: seller.displayName,
        legalName: seller.legalName,
        businessEmail: seller.businessEmail,
        country: seller.country,
        website: seller.website ?? "",
        description: seller.description ?? "",
      }
    : emptyForm;

/**
 * Seller onboarding and dashboard foundation.
 *
 * The page mirrors the server decision: it renders what the API returned and
 * offers an action only when the returned permissions allow it.
 */
export default function SellerDashboardPage() {
  const { session, orgId, setOrgId } = useMarketplaceSession();
  const [dashboard, setDashboard] = useState<SellerDashboard>();
  const [form, setForm] = useState<SellerInput>(emptyForm);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (org: string) => {
    const result = await marketplace.dashboard(org);
    if (!result.ok) {
      setError(explain(result, "The seller dashboard could not be loaded."));
      return;
    }
    setDashboard(result.data);
    setForm(fromSeller(result.data.seller));
  }, []);

  useEffect(() => {
    if (orgId) void load(orgId);
  }, [orgId, load]);

  const field = (key: keyof SellerInput) => ({
    value: (form[key] as string) ?? "",
    onChange: (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => setForm(current => ({ ...current, [key]: event.target.value })),
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await marketplace.saveProfile(orgId, {
      ...form,
      website: form.website || null,
      description: form.description || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(explain(result, "The seller profile was not saved."));
      return;
    }
    setNotice(
      result.data.seller?.status === "draft"
        ? "Saved. Submit the profile for platform review when it is complete."
        : "Seller profile saved."
    );
    await load(orgId);
  };

  const submit = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const result = await marketplace.submitProfile(orgId);
    setBusy(false);
    if (!result.ok) {
      setError(explain(result, "The seller profile was not submitted."));
      return;
    }
    setNotice(
      "Submitted. A platform administrator will review the application."
    );
    await load(orgId);
  };

  if (!session?.authenticated) {
    return (
      <main className="checkout-main page-shell">
        <p role="status">Sign in to continue.</p>
      </main>
    );
  }

  const seller = dashboard?.seller ?? null;
  const editable =
    !seller || seller.status === "draft" || seller.status === "rejected";
  const canManage = dashboard?.permissions.canManage ?? false;

  return (
    <MarketplaceShell
      session={session}
      orgId={orgId}
      onOrgChange={setOrgId}
      section={`HOLO / Seller / ${dashboard?.organization.name ?? "Onboarding"}`}
      heading="Seller studio"
      intro="Your storefront begins with a reviewed business profile, then a catalogue that a platform administrator approves before anything can be sold."
      actions={
        <a className="market-button" href="/seller/products">
          Manage products
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

      <section className="market-panel" aria-labelledby="seller-status-heading">
        <div className="market-panel__head">
          <h2 id="seller-status-heading">Seller application</h2>
          {seller ? (
            <span data-testid="seller-status">
              <MarketStatusBadge status={seller.status} />
            </span>
          ) : (
            <span className="market-muted" data-testid="seller-status">
              Not started
            </span>
          )}
        </div>
        {!seller ? (
          <p>
            No seller profile exists for this organization yet. Complete the
            business details below to begin onboarding.
          </p>
        ) : seller.status === "submitted" ? (
          <p>
            Your application was submitted on{" "}
            {new Date(
              seller.submittedAt ?? seller.updatedAt
            ).toLocaleDateString()}{" "}
            and is awaiting platform review. Business details are locked until
            the review completes.
          </p>
        ) : seller.status === "approved" ? (
          <p>
            This organization is an approved seller. You can create catalogue
            drafts and submit them for review.
          </p>
        ) : seller.status === "rejected" ? (
          <div>
            <p>
              The application needs changes before approval.
              {seller.reviewNote ? (
                <>
                  {" "}
                  Reviewer note: <strong>{seller.reviewNote}</strong>
                </>
              ) : null}
            </p>
            <p>Update the details below and resubmit.</p>
          </div>
        ) : (
          <p>
            Your draft is editable. Submit it when the business details are
            complete.
          </p>
        )}
        {seller &&
        (seller.status === "draft" || seller.status === "rejected") &&
        canManage ? (
          <button
            className="market-button"
            type="button"
            onClick={submit}
            disabled={busy}
            data-testid="seller-submit"
          >
            Submit for review
          </button>
        ) : null}
      </section>

      {editable && canManage ? (
        <section className="market-panel" aria-labelledby="seller-form-heading">
          <div className="market-panel__head">
            <h2 id="seller-form-heading">Business information</h2>
            <span className="market-muted">Owners and admins only</span>
          </div>
          <form
            className="market-form"
            onSubmit={save}
            data-testid="seller-form"
          >
            <p className="market-field">
              <label htmlFor="displayName">Storefront name</label>
              <input
                id="displayName"
                className="market-input"
                required
                {...field("displayName")}
              />
            </p>
            <p className="market-field">
              <label htmlFor="legalName">Registered business name</label>
              <input
                id="legalName"
                className="market-input"
                required
                {...field("legalName")}
              />
            </p>
            <p className="market-field">
              <label htmlFor="businessEmail">Business email</label>
              <input
                id="businessEmail"
                type="email"
                className="market-input"
                required
                {...field("businessEmail")}
              />
            </p>
            <p className="market-field">
              <label htmlFor="country">Country code</label>
              <input
                id="country"
                className="market-input"
                maxLength={2}
                required
                {...field("country")}
              />
            </p>
            <p className="market-field">
              <label htmlFor="website">Website (https, optional)</label>
              <input
                id="website"
                className="market-input"
                {...field("website")}
              />
            </p>
            <p className="market-field market-field--wide">
              <label htmlFor="description">About the studio (optional)</label>
              <textarea
                id="description"
                className="market-input"
                rows={4}
                {...field("description")}
              />
            </p>
            <div className="market-actions">
              <button className="market-button" type="submit" disabled={busy}>
                {seller ? "Save changes" : "Create seller profile"}
              </button>
              {seller?.status === "approved" ? (
                <span className="market-muted">
                  Saving a material change returns the profile to draft for
                  review.
                </span>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="catalogue-heading">
        <div className="market-panel__head">
          <h2 id="catalogue-heading">Catalogue</h2>
          <a href="/seller/products">View all products</a>
        </div>
        <div className="market-stats">
          {(
            ["draft", "submitted", "approved", "rejected", "archived"] as const
          ).map(status => (
            <div className="market-stat" key={status}>
              <span className="mono-label">{status}</span>
              <strong data-testid={`product-count-${status}`}>
                {dashboard?.productCounts[status] ?? 0}
              </strong>
            </div>
          ))}
        </div>
        {!seller || seller.status !== "approved" ? (
          <p className="market-muted">
            Catalogue creation unlocks once the seller application is approved.
          </p>
        ) : null}
      </section>

      <section className="market-panel" aria-labelledby="activity-heading">
        <div className="market-panel__head">
          <h2 id="activity-heading">Recent activity</h2>
          <span className="market-muted">Append-only audit trail</span>
        </div>
        {dashboard?.recentSellerActivity.length ? (
          <ol className="market-activity" data-testid="seller-activity">
            {dashboard.recentSellerActivity.map(event => (
              <li key={event.id}>
                <span className="mono-label">{event.action}</span>
                <span>{event.actorName ?? "system"}</span>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p className="market-muted">No seller activity recorded yet.</p>
        )}
      </section>
    </MarketplaceShell>
  );
}
