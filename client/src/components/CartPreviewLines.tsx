import { type cartPreview, previewMoney } from "../lib/cart";

export function CartPreviewLines({
  preview: p,
}: {
  preview: ReturnType<typeof cartPreview>;
}) {
  return (
    <>
      <span>
        Subtotal <b>{previewMoney(p.subtotal)}</b>
      </span>
      {p.discount > 0 && (
        <span>
          HOLO10 <b>−{previewMoney(p.discount)}</b>
        </span>
      )}
      {p.wrap > 0 && (
        <span>
          Gift wrapping <b>{previewMoney(p.wrap)}</b>
        </span>
      )}
      <span>
        Shipping estimate <b>{previewMoney(p.shipping)}</b>
      </span>
      <span>
        Tax estimate <b>{previewMoney(p.tax)}</b>
      </span>
      <strong className="summary-total">
        Preview total <b>{previewMoney(p.total)}</b>
      </strong>
    </>
  );
}
