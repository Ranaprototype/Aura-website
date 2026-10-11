import type { ReactElement } from "react";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Heart,
  MapPin,
  Package,
  Settings,
  UserRound,
} from "lucide-react";
import {
  getWishlist,
  products,
  productHref,
  formatPrice,
} from "../lib/catalog";
type Order = {
  order: string;
  total: number;
  email?: string;
  items?: Array<{ name: string; quantity: number; price: number }>;
  date?: string;
  firstName?: string;
  address?: string;
  city?: string;
  postal?: string;
};
const readOrders = (): Order[] => {
  try {
    return JSON.parse(localStorage.getItem("holo.orders") || "[]");
  } catch {
    return [];
  }
};
function Nav() {
  return (
    <header className="account-header">
      <a className="wordmark" href="/">
        HOLO
      </a>
      <a className="commerce-back" href="/catalog">
        <ArrowLeft size={14} /> Continue shopping
      </a>
    </header>
  );
}
function Sidebar({ active }: { active: string }) {
  const links = [
    ["/account", "Overview", UserRound],
    ["/account/orders", "Orders", Package],
    ["/account/addresses", "Addresses", MapPin],
    ["/account/wishlist", "Wishlist", Heart],
    ["/account/settings", "Settings", Settings],
  ] as const;
  return (
    <aside className="account-sidebar">
      <div className="account-avatar">
        <UserRound size={18} />
      </div>
      <span className="mono-label">HOLO ACCOUNT</span>
      <nav>
        {links.map(([href, label, Icon]) => (
          <a className={active === href ? "active" : ""} href={href} key={href}>
            <Icon size={15} /> {label}
          </a>
        ))}
      </nav>
      <button
        onClick={() => {
          localStorage.removeItem("holo.user");
          window.location.href = "/";
        }}
      >
        Sign out
      </button>
    </aside>
  );
}
function Empty({
  icon: Icon,
  title,
  copy,
  href,
  label,
}: {
  icon: typeof Package;
  title: string;
  copy: string;
  href?: string;
  label?: string;
}) {
  return (
    <div className="account-empty">
      <Icon size={28} />
      <h2>{title}</h2>
      <p>{copy}</p>
      {href && (
        <a className="button button--primary" href={href}>
          {label}
        </a>
      )}
    </div>
  );
}
export default function AccountPage({ path }: { path: string }) {
  const [orders] = useState<Order[]>(readOrders);
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("holo.user") || "{}");
    } catch {
      return {};
    }
  })();
  const active =
    path === "/account"
      ? "/account"
      : path.startsWith("/account/orders")
        ? "/account/orders"
        : path;
  const detailId = path.match(/^\/account\/orders\/([^/]+)/)?.[1];
  const detail = detailId ? orders.find(o => o.order === detailId) : null;
  const [name, setName] = useState(user.name || "Guest");
  const [email, setEmail] = useState(user.email || "");
  const [addresses, setAddresses] = useState<
    Array<{ id: string; label: string; line: string }>
  >(() => {
    try {
      return JSON.parse(localStorage.getItem("holo.addresses.v1") || "[]");
    } catch {
      return [];
    }
  });
  const [addressLabel, setAddressLabel] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const wishlist = products.filter(p => getWishlist().includes(p.slug));
  const saveUser = () => {
    localStorage.setItem(
      "holo.user",
      JSON.stringify({
        name,
        email,
        createdAt: user.createdAt || new Date().toISOString(),
      })
    );
  };
  let content: ReactElement;
  if (detail) {
    content = (
      <>
        <a className="commerce-back" href="/account/orders">
          <ArrowLeft size={14} /> All orders
        </a>
        <span className="mono-label">ORDER DETAIL / {detail.order}</span>
        <h1>
          Order <em>{detail.order}</em>
        </h1>
        <div className="tracking-timeline">
          {[
            "Order placed",
            "Confirmed",
            "Packed",
            "Shipped",
            "Out for delivery",
            "Delivered",
          ].map((step, i) => (
            <div
              className={i < 2 ? "done" : i === 2 ? "current" : ""}
              key={step}
            >
              <span>{i < 2 ? <Check size={12} /> : i + 1}</span>
              <b>{step}</b>
            </div>
          ))}
        </div>
        <div className="account-card">
          <span className="mono-label">ORDER SUMMARY</span>
          {detail.items?.map(item => (
            <div className="account-order-row" key={item.name}>
              <span>
                {item.quantity} × {item.name}
              </span>
              <b>{formatPrice(item.price * item.quantity)}</b>
            </div>
          ))}
          <strong>
            Total <em>${detail.total.toLocaleString()}.00</em>
          </strong>
        </div>
        <button
          className="button button--primary"
          onClick={() => alert("Reorder added to your cart in this demo.")}
        >
          Reorder <ArrowRight size={15} />
        </button>
      </>
    );
  } else if (path === "/account/orders") {
    content = (
      <>
        <span className="mono-label">ACCOUNT / ORDERS</span>
        <h1>
          Your <em>orders.</em>
        </h1>
        {orders.length ? (
          <div className="account-list">
            {orders.map(o => (
              <a
                className="account-card account-order"
                href={`/account/orders/${o.order}`}
                key={o.order}
              >
                <div>
                  <span className="mono-label">{o.order}</span>
                  <strong>{o.items?.length || 0} line items</strong>
                </div>
                <div>
                  <b>${o.total.toLocaleString()}.00</b>
                  <small>
                    Confirmed · View <ArrowRight size={13} />
                  </small>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <Empty
            icon={Package}
            title="No orders yet"
            copy="Your future objects will appear here."
            href="/catalog"
            label="Start shopping"
          />
        )}
      </>
    );
  } else if (path === "/account/addresses") {
    const saveAddress = () => {
      if (!addressLabel || !addressLine) return;
      const next = [
        ...addresses,
        { id: Date.now().toString(), label: addressLabel, line: addressLine },
      ];
      setAddresses(next);
      localStorage.setItem("holo.addresses.v1", JSON.stringify(next));
      setAddressLabel("");
      setAddressLine("");
    };
    const removeAddress = (id: string) => {
      const next = addresses.filter(a => a.id !== id);
      setAddresses(next);
      localStorage.setItem("holo.addresses.v1", JSON.stringify(next));
    };
    content = (
      <>
        <span className="mono-label">ACCOUNT / ADDRESSES</span>
        <h1>
          Your <em>addresses.</em>
        </h1>
        <div className="addresses-list">
          {addresses.map(a => (
            <div className="account-card saved-address" key={a.id}>
              <div>
                <strong>{a.label}</strong>
                <p>{a.line}</p>
              </div>
              <button onClick={() => removeAddress(a.id)}>Delete</button>
            </div>
          ))}
        </div>
        <div className="account-card address-form">
          <label>
            Label
            <input
              value={addressLabel}
              onChange={e => setAddressLabel(e.target.value)}
              placeholder="Home, Studio…"
            />
          </label>
          <label>
            Address
            <input
              value={addressLine}
              onChange={e => setAddressLine(e.target.value)}
              placeholder="Street, city, postal code"
            />
          </label>
          <button className="button button--primary" onClick={saveAddress}>
            Save address <Check size={15} />
          </button>
        </div>
        {!addresses.length && (
          <p className="address-note">
            Add your first address to make checkout faster.
          </p>
        )}
      </>
    );
  } else if (path === "/account/wishlist") {
    content = (
      <>
        <span className="mono-label">ACCOUNT / WISHLIST</span>
        <h1>
          Saved <em>objects.</em>
        </h1>
        {wishlist.length ? (
          <div className="account-wishlist">
            {wishlist.map(p => (
              <a href={productHref(p)} key={p.slug}>
                <div className={`catalog-visual catalog-visual--${p.tone}`}>
                  <div className={`catalog-shape catalog-shape--${p.kind}`} />
                </div>
                <strong>{p.name}</strong>
                <span>{formatPrice(p.price)}</span>
              </a>
            ))}
          </div>
        ) : (
          <Empty
            icon={Heart}
            title="Nothing saved yet"
            copy="Explore the catalog and save what speaks to you."
            href="/catalog"
            label="Explore catalog"
          />
        )}
      </>
    );
  } else if (path === "/account/settings") {
    content = (
      <>
        <span className="mono-label">ACCOUNT / SETTINGS</span>
        <h1>
          Your <em>settings.</em>
        </h1>
        <div className="account-card settings-form">
          <label>
            Name
            <input value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label>
            Email
            <input value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" defaultChecked /> Product updates and studio
            notes
          </label>
          <button className="button button--primary" onClick={saveUser}>
            Save settings <Check size={15} />
          </button>
        </div>
      </>
    );
  } else {
    content = (
      <>
        <span className="mono-label">WELCOME BACK</span>
        <h1>
          Hello, <em>{name || "there"}.</em>
        </h1>
        <p className="account-lede">
          Your considered objects, orders, and saved ideas in one quiet place.
        </p>
        <div className="account-quick-grid">
          <a href="/account/orders">
            <Package />
            <b>{orders.length} Orders</b>
            <small>View history</small>
          </a>
          <a href="/account/wishlist">
            <Heart />
            <b>Wishlist</b>
            <small>{wishlist.length} saved</small>
          </a>
          <a href="/account/addresses">
            <MapPin />
            <b>Addresses</b>
            <small>Manage delivery</small>
          </a>
          <a href="/account/settings">
            <Settings />
            <b>Settings</b>
            <small>Update profile</small>
          </a>
        </div>
      </>
    );
  }
  return (
    <div className="account-page">
      <Nav />
      <main className="account-shell">
        <Sidebar active={active} />
        <section className="account-content">{content}</section>
      </main>
    </div>
  );
}
