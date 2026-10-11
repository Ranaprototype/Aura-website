import { ArrowRight, Check, PackageCheck, Sparkles } from "lucide-react";
export default function OrderConfirmationPage() {
  let data: { order?: string; total?: number; email?: string } = {};
  try {
    data = JSON.parse(localStorage.getItem("holo-last-order") || "{}");
  } catch {}
  const order =
    window.location.pathname.match(/^\/order\/([^/]+)/)?.[1] ||
    new URLSearchParams(window.location.search).get("order") ||
    data.order ||
    "HL-PENDING";
  return (
    <div className="confirmation-page commerce-page">
      <header className="commerce-header">
        <a className="wordmark" href="/">
          HOLO
        </a>
        <span className="mono-label">ORDER CONFIRMED / {order}</span>
      </header>
      <main className="confirmation-main">
        <div className="confirmation-orb">
          <Check size={34} />
        </div>
        <span className="mono-label">THANK YOU FOR CHOOSING LIGHT</span>
        <h1>
          It’s officially
          <br />
          <em>yours.</em>
        </h1>
        <p className="confirmation-lede">
          Your HOLO object is now moving from our studio to your world.
        </p>
        <div className="confirmation-card">
          <div>
            <PackageCheck size={18} />
            <span>Order number</span>
            <strong>{order}</strong>
          </div>
          <div>
            <Sparkles size={18} />
            <span>Estimated delivery</span>
            <strong>3–5 business days</strong>
          </div>
          <div>
            <span>Confirmation sent to</span>
            <strong>{data.email || "your email address"}</strong>
          </div>
          {data.total && (
            <div>
              <span>Total paid</span>
              <strong>${data.total.toLocaleString()}.00</strong>
            </div>
          )}
        </div>
        <div className="confirmation-actions">
          <a className="button button--primary" href="/catalog">
            Continue exploring <ArrowRight size={15} />
          </a>
          <a className="button button--ghost" href="/">
            Return home
          </a>
        </div>
        <p className="confirmation-note">
          This is a demo checkout flow. No payment has been processed.
        </p>
      </main>
    </div>
  );
}
