import { CartPreviewLines } from "./CartPreviewLines";
import { useEffect, useRef, useState } from "react";
import AccountModal from "./AccountModal";
import {
  ArrowRight,
  Check,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import {
  cartCount,
  cartPreview,
  previewMoney,
  getCartState,
  getSavedForLater,
  removeFromCart,
  restoreSavedItem,
  saveForLater,
  setPromo,
  toggleGiftWrap,
  updateCartQuantity,
  type CartItem,
} from "../lib/cart";

export default function CommerceOverlay() {
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState(getCartState);
  const { items } = cart;
  const [saved, setSaved] = useState<CartItem[]>([]);
  const [promo, setPromoState] = useState("");
  const [promoError, setPromoError] = useState("");
  const [toast, setToast] = useState<{
    item?: CartItem;
    message: string;
  } | null>(null);
  const [hover, setHover] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const sync = () => {
    const s = getCartState();
    setCart(s);
    setSaved(getSavedForLater());
    setPromoState(s.promo || "");
  };
  useEffect(() => {
    sync();
    const onCart = () => sync();
    const onOpen = () => setOpen(true);
    const onAdded = (e: Event) => {
      sync();
      const item = (e as CustomEvent).detail?.item as CartItem | undefined;
      setToast({ item, message: "Added to cart" });
      window.setTimeout(() => setToast(null), 4500);
    };
    window.addEventListener("holo-cart-change", onCart);
    window.addEventListener("holo-open-cart", onOpen);
    window.addEventListener("holo-cart-added", onAdded);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("holo-cart-change", onCart);
      window.removeEventListener("holo-open-cart", onOpen);
      window.removeEventListener("holo-cart-added", onAdded);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const preview = cartPreview(cart);
  const apply = () => {
    if (promo.toUpperCase() === "HOLO10") {
      setPromo("HOLO10");
      setPromoError("");
    } else setPromoError("Try HOLO10");
  };
  return (
    <>
      <AccountModal />
      {(open || hover) && (
        <div
          className={
            open ? "drawer-backdrop is-open" : "drawer-preview-backdrop"
          }
          onClick={() => open && setOpen(false)}
        />
      )}
      {open && (
        <aside
          className="cart-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Your cart"
          tabIndex={-1}
        >
          <div className="drawer-head">
            <div>
              <span className="mono-label">
                HOLO / {cartCount(items).toString().padStart(2, "0")}
              </span>
              <h2>Your Cart</h2>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close cart">
              <X />
            </button>
          </div>
          {!items.length ? (
            <div className="drawer-empty">
              <ShoppingBag size={30} />
              <h3>Your cart is empty</h3>
              <p>Start with a configurator or browse the catalog.</p>
              <a className="button button--primary" href="/catalog">
                Browse Catalog
              </a>
              <a className="drawer-link" href="/product/sneaker">
                Customize Something
              </a>
            </div>
          ) : (
            <>
              <div className="drawer-items">
                {items.map(item => (
                  <article className="drawer-item" key={item.id}>
                    <div className={`drawer-thumb cart-visual--${item.tone}`}>
                      <i />
                    </div>
                    <div className="drawer-item-copy">
                      <b>{item.name}</b>
                      <small>
                        {item.configuration || "Standard"}
                        {item.size ? ` · Size ${item.size}` : ""}
                      </small>
                      <div className="drawer-item-links">
                        <button onClick={() => removeFromCart(item.id)}>
                          Remove
                        </button>
                        <button onClick={() => saveForLater(item.id)}>
                          Save for later
                        </button>
                      </div>
                      <label className="gift-toggle">
                        <input
                          type="checkbox"
                          checked={!!item.giftWrap}
                          onChange={() => toggleGiftWrap(item.id)}
                        />{" "}
                        Gift wrap +$5
                      </label>
                      <div className="drawer-item-bottom">
                        <div className="quantity-control">
                          <button
                            aria-label={`Decrease ${item.name}`}
                            onClick={() =>
                              updateCartQuantity(item.id, item.quantity - 1)
                            }
                          >
                            <Minus size={12} />
                          </button>
                          <span aria-live="polite">{item.quantity}</span>
                          <button
                            aria-label={`Increase ${item.name}`}
                            onClick={() =>
                              updateCartQuantity(item.id, item.quantity + 1)
                            }
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                        <strong>
                          {previewMoney(
                            Math.round(item.price * 100) * item.quantity
                          )}
                        </strong>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div className="drawer-promo">
                <input
                  value={promo}
                  onChange={e => setPromoState(e.target.value)}
                  placeholder="Promo code"
                  aria-label="Promo code"
                />
                <button onClick={apply}>Apply</button>
                {promoError && <small>{promoError}</small>}
              </div>
              <div className="drawer-summary">
                <CartPreviewLines preview={preview} />
                <small>Preview estimate · Purchases unavailable</small>
                <a className="button button--primary" href="/checkout">
                  Checkout information <ArrowRight size={15} />
                </a>
                <a
                  className="drawer-link"
                  href="/catalog"
                  onClick={() => setOpen(false)}
                >
                  Continue shopping
                </a>
              </div>
            </>
          )}
        </aside>
      )}
      {!open && hover && items.length > 0 && (
        <div
          className="mini-cart"
          onMouseEnter={() => {
            if (timer.current) window.clearTimeout(timer.current);
            setHover(true);
          }}
          onMouseLeave={() => setHover(false)}
        >
          <span className="mono-label">QUICK CART / {cartCount(items)}</span>
          {items.slice(0, 3).map(i => (
            <div key={i.id}>
              <span>{i.name}</span>
              <b>{previewMoney(Math.round(i.price * 100) * i.quantity)}</b>
            </div>
          ))}
          <strong>
            Preview total <b>{previewMoney(preview.total)}</b>
          </strong>
          <button onClick={() => setOpen(true)}>
            View Cart <ArrowRight size={13} />
          </button>
        </div>
      )}
      {toast && (
        <div className="cart-toast" role="status">
          <div className="toast-icon">
            <Check size={15} />
          </div>
          <div>
            <b>{toast.item?.name || "Object"}</b>
            <span>Added to cart</span>
          </div>
          <button
            onClick={() => {
              setOpen(true);
              setToast(null);
            }}
          >
            View Cart
          </button>
          <button className="toast-close" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
export function openCart() {
  window.dispatchEvent(new Event("holo-open-cart"));
}
