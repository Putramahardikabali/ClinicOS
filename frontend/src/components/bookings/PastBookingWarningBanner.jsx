import {
  isInternalPastScheduled,
  PAST_BOOKING_WARNING,
} from "@/lib/pastBookingPolicy";

export function PastBookingWarningBanner({ scheduleDate, timeStr, timezone }) {
  if (!isInternalPastScheduled({ scheduleDate, timeStr, timezone })) return null;
  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      data-testid="past-booking-warning"
    >
      {PAST_BOOKING_WARNING} Internal users can still save after confirming.
    </div>
  );
}

export default PastBookingWarningBanner;
