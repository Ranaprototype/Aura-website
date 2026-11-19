import { CommerceStatus } from "../components/CommerceStatus";
import { getWishlist, products, productHref } from "../lib/catalog";

export default function AccountPage({ path }: { path: string }) {
  if (path === "/account/wishlist") {
    const slugs = new Set(getWishlist());
    const saved = products.filter(p => slugs.has(p.slug));
    return (
      <CommerceStatus title="Saved objects." section="On this device">
        <p>Your wishlist is local to this browser, not linked to an account.</p>
        {saved.length ? (
          <div className="account-wishlist">
            {saved.map(p => (
              <a key={p.slug} href={productHref(p)}>
                {p.name}
              </a>
            ))}
          </div>
        ) : (
          <p>Nothing saved yet.</p>
        )}
      </CommerceStatus>
    );
  }
  return (
    <CommerceStatus section="Account" title="Accounts are unavailable.">
      <p>Sign-in, saved addresses and order history are not available.</p>
      <p>
        <a href="/account/wishlist">View this device’s wishlist</a>
      </p>
    </CommerceStatus>
  );
}
