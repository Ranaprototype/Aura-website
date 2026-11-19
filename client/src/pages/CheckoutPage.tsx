import { CommerceStatus } from "../components/CommerceStatus";

export default function CheckoutPage() {
  return (
    <CommerceStatus
      section="Checkout"
      title="Checkout is unavailable."
      href="/cart"
      link="Back to cart"
    >
      <p>
        You can explore and customize objects. We are not accepting orders or
        payments.
      </p>
    </CommerceStatus>
  );
}
