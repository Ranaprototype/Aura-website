import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
} from "lucide-react";
import {
  cartCount,
  cartSubtotal,
  getCart,
  removeFromCart,
  updateCartQuantity,
  type CartItem,
} from "../lib/cart";

function CartHeader({ count }: { count: number }) {
  return (
    <header className="commerce-header">
      <a className="wordmark" href="/">
        HOLO
      </a>
      <div>
        <span className="mono-label">
          CART / {count.toString().padStart(2, "0")}
        </span>
        <a className="commerce-back" href="/catalog">
          <ArrowLeft size={14} /> Continue shopping
        </a>
      </div>
    </header>
  );
}
function Visual({ item }: { item: CartItem }) {
  return (
    <div className={`cart-visual cart-visual--${item.tone}`}>
      <span>{item.category}</span>
      <i />
    </div>
  );
}
export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>(getCart);
  useEffect(() => {
    const sync = () => setItems(getCart());
    window.addEventListener("holo-cart-change", sync);
    return () => window.removeEventListener("holo-cart-change", sync);
  }, []);
  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const shipping = subtotal >= 200 || subtotal === 0 ? 0 : 18;
  const total = subtotal + shipping;
  return (
    <div className="commerce-page">
      <CartHeader count={cartCount()} />
      <main className="cart-main page-shell">
        {items.length === 0 ? (
          <section className="cart-empty">
            <ShoppingBag size={30} />
            <span className="mono-label">YOUR CART / 00</span>
            <h1>
              Nothing here
              <br />
              <em>yet.</em>
            </h1>
            <p>Start with a considered object from the HOLO catalog.</p>
            <a className="button button--primary" href="/catalog">
              Explore the collection <ArrowRight size={15} />
            </a>
          </section>
        ) : (
          <>
            <div className="commerce-heading">
              <div>
                <span className="mono-label">
                  YOUR SELECTION / {items.length.toString().padStart(2, "0")}{" "}
                  LINES
                </span>
                <h1>Your cart.</h1>
              </div>
              <span className="cart-status">
                <ShieldCheck size={15} /> Secure local session
              </span>
            </div>
            <div className="cart-layout">
              <section className="cart-lines">
                {items.map(item => (
                  <article className="cart-line" key={item.id}>
                    <Visual item={item} />
                    <div className="cart-line-copy">
                      <span className="mono-label">
                        {item.category} / {item.configuration || "STANDARD"}
                      </span>
                      <h2>{item.name}</h2>
                      <p>
                        {item.size ? `Size ${item.size} · ` : ""}
                        {item.configuration || "Ready to ship"}
                      </p>
                      <strong>${item.price.toLocaleString()}.00</strong>
                    </div>
                    <div className="quantity-control">
                      <button
                        aria-label={`Decrease ${item.name}`}
                        onClick={() =>
                          updateCartQuantity(item.id, item.quantity - 1)
                        }
                      >
                        <Minus size={13} />
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        aria-label={`Increase ${item.name}`}
                        onClick={() =>
                          updateCartQuantity(item.id, item.quantity + 1)
                        }
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                    <button
                      className="cart-remove"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => removeFromCart(item.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </section>
              <aside className="order-summary">
                <span className="mono-label">ORDER SUMMARY</span>
                <h2>
                  Almost
                  <br />
                  <em>yours.</em>
                </h2>
                <div className="summary-lines">
                  <span>
                    Subtotal <b>${subtotal.toLocaleString()}.00</b>
                  </span>
                  <span>
                    Shipping <b>{shipping ? `$${shipping}.00` : "Free"}</b>
                  </span>
                  <span className="summary-total">
                    Total <b>${total.toLocaleString()}.00</b>
                  </span>
                </div>
                {subtotal > 0 && subtotal < 200 && (
                  <div className="shipping-progress">
                    <Truck size={14} /> Add ${(200 - subtotal).toLocaleString()}
                    .00 for free shipping.
                  </div>
                )}
                <a
                  className="button button--primary checkout-button"
                  href="/checkout"
                >
                  Proceed to checkout <ArrowRight size={15} />
                </a>
                <p className="secure-note">
                  <ShieldCheck size={13} /> 30-day returns · Secure checkout
                </p>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
