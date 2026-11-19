import { CommerceStatus } from "../components/CommerceStatus";

export default function OrderConfirmationPage() {
  return (
    <CommerceStatus section="Orders" title="Order verification unavailable.">
      <p>This page cannot verify an order or a payment.</p>
    </CommerceStatus>
  );
}
