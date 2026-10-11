import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { cartSubtotal, clearCart, getCart, type CartItem } from "../lib/cart";

type Form = {
  email: string;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  postal: string;
  country: string;
  card: string;
  expiry: string;
  cvc: string;
};
const empty: Form = {
  email: "",
  firstName: "",
  lastName: "",
  address: "",
  city: "",
  postal: "",
  country: "India",
  card: "",
  expiry: "",
  cvc: "",
};
const steps = ["Shipping", "Delivery", "Payment", "Review"];
function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = true,
  autoComplete,
}: {
  label: string;
  name: keyof Form;
  value: string;
  onChange: (name: keyof Form, value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="checkout-field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        aria-label={label}
        onChange={e => onChange(name, e.target.value)}
      />
    </label>
  );
}
export default function CheckoutPage() {
  const [items] = useState<CartItem[]>(getCart);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(() => {
    try {
      return {
        ...empty,
        ...JSON.parse(localStorage.getItem("holo-checkout") || "{}"),
      };
    } catch {
      return empty;
    }
  });
  const [delivery, setDelivery] = useState("standard");
  const stepRef = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const shipping = delivery === "express" ? 28 : subtotal >= 200 ? 0 : 18;
  const total = subtotal + shipping;
  useEffect(() => {
    localStorage.setItem("holo-checkout", JSON.stringify(form));
  }, [form]);
  useEffect(() => {
    window.setTimeout(() => stepRef.current?.focus(), 40);
  }, [step]);
  const update = (name: keyof Form, value: string) =>
    setForm(current => ({ ...current, [name]: value }));
  const next = (event?: FormEvent) => {
    event?.preventDefault();
    if (
      step === 0 &&
      (!form.email ||
        !form.firstName ||
        !form.lastName ||
        !form.address ||
        !form.city ||
        !form.postal)
    )
      return setError("Complete all required shipping fields to continue.");
    if (step === 2 && (!form.card || !form.expiry || !form.cvc))
      return setError("Enter the payment details to continue.");
    setError("");
    setStep(current => Math.min(3, current + 1));
  };
  const formatCard = (value: string) =>
    value
      .replace(/\D/g, "")
      .slice(0, 16)
      .replace(/(.{4})/g, "$1 ")
      .trim();
  const brand = form.card.replace(/\D/g, "").startsWith("4")
    ? "VISA"
    : form.card.replace(/\D/g, "").startsWith("5")
      ? "MASTERCARD"
      : "CARD";
  const submitPayment = () => {
    if (form.card.replace(/\D/g, "") === "4000000000000002") {
      setError("Payment was declined. Please try another test card.");
      return;
    }
    setProcessing(true);
    window.setTimeout(() => {
      setProcessing(false);
      placeOrder();
    }, 1800);
  };
  const placeOrder = () => {
    const order = `HOLO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
    const record = {
      order,
      total,
      email: form.email,
      items,
      firstName: form.firstName,
      address: form.address,
      city: form.city,
      postal: form.postal,
      date: new Date().toISOString(),
    };
    const previous = JSON.parse(localStorage.getItem("holo.orders") || "[]");
    localStorage.setItem("holo.orders", JSON.stringify([record, ...previous]));
    localStorage.setItem("holo-last-order", JSON.stringify(record));
    clearCart();
    localStorage.removeItem("holo-checkout");
    window.location.href = `/order/${order}`;
  };
  if (!items.length)
    return (
      <div className="commerce-page">
        <header className="commerce-header">
          <a className="wordmark" href="/">
            HOLO
          </a>
        </header>
        <main className="checkout-empty">
          <ShoppingBagIcon />
          <h1>Your cart is empty.</h1>
          <a className="button button--primary" href="/catalog">
            Return to catalog
          </a>
        </main>
      </div>
    );
  return (
    <div className="commerce-page">
      <header className="commerce-header">
        <a className="wordmark" href="/">
          HOLO
        </a>
        <div className="checkout-secure">
          <LockKeyhole size={13} /> Secure checkout
        </div>
      </header>
      <main className="checkout-main page-shell">
        <a className="commerce-back" href="/cart">
          <ArrowLeft size={14} /> Back to cart
        </a>
        <div className="checkout-heading">
          <span className="mono-label">HOLO / CHECKOUT</span>
          <h1>
            Make it <em>yours.</em>
          </h1>
        </div>
        <div className="stepper">
          {steps.map((item, index) => (
            <div className={index <= step ? "active" : ""} key={item}>
              <span>
                {index < step ? <Check size={13} /> : `0${index + 1}`}
              </span>
              <b>{item}</b>
            </div>
          ))}
        </div>
        <div className="checkout-layout">
          <form className="checkout-form" onSubmit={next}>
            <div className="sr-only" aria-live="polite">
              Step {step + 1} of 4: {steps[step]}
            </div>
            {step === 0 && (
              <section className="checkout-section" ref={stepRef} tabIndex={-1}>
                <div className="checkout-section-heading">
                  <MapPin size={18} />
                  <div>
                    <span className="mono-label">STEP 01 / SHIPPING</span>
                    <h2>Where should we send it?</h2>
                  </div>
                </div>
                <div className="field-grid">
                  <Field
                    label="Email"
                    name="email"
                    type="email"
                    value={form.email}
                    autoComplete="email"
                    onChange={update}
                  />
                  <Field
                    label="Country"
                    name="country"
                    value={form.country}
                    onChange={update}
                  />
                  <Field
                    label="First name"
                    name="firstName"
                    value={form.firstName}
                    autoComplete="given-name"
                    onChange={update}
                  />
                  <Field
                    label="Last name"
                    name="lastName"
                    value={form.lastName}
                    autoComplete="family-name"
                    onChange={update}
                  />
                  <Field
                    label="Address"
                    name="address"
                    value={form.address}
                    autoComplete="street-address"
                    onChange={update}
                  />
                  <Field
                    label="City"
                    name="city"
                    value={form.city}
                    autoComplete="address-level2"
                    onChange={update}
                  />
                  <Field
                    label="Postal code"
                    name="postal"
                    value={form.postal}
                    autoComplete="postal-code"
                    onChange={update}
                  />
                </div>
              </section>
            )}
            {step === 1 && (
              <section className="checkout-section" ref={stepRef} tabIndex={-1}>
                <div className="checkout-section-heading">
                  <Truck size={18} />
                  <div>
                    <span className="mono-label">STEP 02 / DELIVERY</span>
                    <h2>Choose your pace.</h2>
                  </div>
                </div>
                <div className="delivery-options">
                  <label className={delivery === "standard" ? "selected" : ""}>
                    <input
                      type="radio"
                      checked={delivery === "standard"}
                      onChange={() => setDelivery("standard")}
                    />
                    <span>
                      <b>Standard delivery</b>
                      <small>3–5 business days</small>
                    </span>
                    <strong>{subtotal >= 200 ? "Free" : "$18.00"}</strong>
                  </label>
                  <label className={delivery === "express" ? "selected" : ""}>
                    <input
                      type="radio"
                      checked={delivery === "express"}
                      onChange={() => setDelivery("express")}
                    />
                    <span>
                      <b>Express delivery</b>
                      <small>1–2 business days</small>
                    </span>
                    <strong>$28.00</strong>
                  </label>
                </div>
              </section>
            )}
            {step === 2 && (
              <section className="checkout-section" ref={stepRef} tabIndex={-1}>
                <div className="checkout-section-heading">
                  <CreditCard size={18} />
                  <div>
                    <span className="mono-label">STEP 03 / PAYMENT</span>
                    <h2>Pay securely.</h2>
                  </div>
                </div>
                <div className="field-grid">
                  <Field
                    label={`Card number · ${brand}`}
                    name="card"
                    value={form.card}
                    onChange={(name, value) => update(name, formatCard(value))}
                  />
                  <Field
                    label="Expiry"
                    name="expiry"
                    value={form.expiry}
                    onChange={(name, value) =>
                      update(
                        name,
                        value
                          .replace(/\D/g, "")
                          .slice(0, 4)
                          .replace(/(\d{2})(\d)/, "$1 / $2")
                      )
                    }
                  />
                  <Field
                    label="Security code"
                    name="cvc"
                    value={form.cvc}
                    onChange={(name, value) =>
                      update(name, value.replace(/\D/g, "").slice(0, 3))
                    }
                    type="password"
                  />
                  <p className="payment-note">
                    <LockKeyhole size={13} /> Demo payment environment — no
                    charge will be made.
                  </p>
                </div>
              </section>
            )}
            {step === 3 && (
              <section
                className="checkout-section review-section"
                ref={stepRef}
                tabIndex={-1}
              >
                <div className="checkout-section-heading">
                  <ShieldCheck size={18} />
                  <div>
                    <span className="mono-label">STEP 04 / REVIEW</span>
                    <h2>One last look.</h2>
                  </div>
                </div>
                <div className="review-card">
                  <span>Deliver to</span>
                  <strong>
                    {form.firstName} {form.lastName}
                  </strong>
                  <p>
                    {form.address}, {form.city}, {form.postal}, {form.country}
                    <br />
                    {form.email}
                  </p>
                  <button type="button" onClick={() => setStep(0)}>
                    Edit shipping
                  </button>
                </div>
                <div className="review-card">
                  <span>Delivery</span>
                  <strong>
                    {delivery === "express"
                      ? "Express delivery"
                      : "Standard delivery"}
                  </strong>
                  <p>
                    {delivery === "express"
                      ? "1–2 business days"
                      : "3–5 business days"}
                  </p>
                  <button type="button" onClick={() => setStep(1)}>
                    Edit delivery
                  </button>
                </div>
                <div className="review-card">
                  <span>Payment</span>
                  <strong>
                    Card ending in {form.card.slice(-4) || "••••"}
                  </strong>
                  <p>Your payment details are encrypted.</p>
                  <button type="button" onClick={() => setStep(2)}>
                    Edit payment
                  </button>
                </div>
              </section>
            )}
            {error && (
              <p className="checkout-error" role="alert">
                {error}
              </p>
            )}
            <div className="checkout-actions">
              {step > 0 && (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setError("");
                    setStep(current => current - 1);
                  }}
                >
                  <ArrowLeft size={15} /> Back
                </button>
              )}
              {step < 3 ? (
                <button className="button button--primary" type="submit">
                  Continue to {steps[step + 1]} <ArrowRight size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary"
                  disabled={processing}
                  onClick={submitPayment}
                >
                  {processing ? (
                    <>
                      PROCESSING PAYMENT… <span className="processing-ring" />
                    </>
                  ) : (
                    <>
                      Place order <Check size={15} />
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
          <aside className="checkout-summary">
            <span className="mono-label">
              YOUR ORDER / {items.length.toString().padStart(2, "0")}
            </span>
            {items.map(item => (
              <div className="checkout-item" key={item.id}>
                <span>
                  {item.quantity} × {item.name}
                </span>
                <b>${(item.price * item.quantity).toLocaleString()}.00</b>
              </div>
            ))}
            <div className="checkout-total">
              <span>Subtotal</span>
              <b>${subtotal.toLocaleString()}.00</b>
              <span>Shipping</span>
              <b>{shipping ? `$${shipping}.00` : "Free"}</b>
              <strong>
                Total <em>${total.toLocaleString()}.00</em>
              </strong>
            </div>
            <p>
              <ShieldCheck size={13} /> Encrypted checkout · 30-day returns
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
function ShoppingBagIcon() {
  return (
    <div className="checkout-empty-icon">
      <ShoppingBag size={32} />
    </div>
  );
}
