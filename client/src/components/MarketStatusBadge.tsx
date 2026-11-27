/** Lifecycle badge. Colour is decorative; the label carries the meaning. */
export function MarketStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`market-badge market-badge--${status}`}
      data-status={status}
    >
      {status}
    </span>
  );
}
