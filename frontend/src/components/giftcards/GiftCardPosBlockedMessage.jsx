import { Link } from "react-router-dom";

/** Shown when a treatment/package gift card is entered on POS payment. */
export default function GiftCardPosBlockedMessage({ card, onClear }) {
  const label =
    card?.treatment_name_snapshot
    || card?.package_name_snapshot
    || "Treatment/Package";

  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm space-y-2"
      data-testid="gift-card-pos-blocked"
      role="alert"
    >
      <p className="text-amber-950 font-medium">
        Treatment and package gift cards must be redeemed when creating a booking so availability can be checked.
      </p>
      <p className="text-xs text-amber-900">
        {label} gift card · code {card?.code}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          to="/bookings"
          className="bl-btn-primary text-xs py-2 px-3"
          data-testid="gift-card-create-booking-cta"
        >
          Create booking with this gift card
        </Link>
        {onClear && (
          <button type="button" className="bl-btn-ghost text-xs" onClick={onClear}>
            Clear code
          </button>
        )}
      </div>
    </div>
  );
}
