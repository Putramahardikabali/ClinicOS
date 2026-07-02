import { hhmmToMin, isPastEmptySlot } from "@/components/bookings/scheduleUtils";

export const PAST_BOOKING_WARNING = "This appointment time is in the past.";

export function isInternalPastScheduled({ scheduleDate, timeStr, timezone, now }) {
  const slotMin = hhmmToMin(timeStr);
  if (slotMin == null || !scheduleDate || !timeStr) return false;
  return isPastEmptySlot({ scheduleDate, slotMin, timezone, now });
}

export function parsePastBookingError(detail) {
  if (detail && typeof detail === "object" && detail.code === "past_booking_warning") {
    return detail.message || PAST_BOOKING_WARNING;
  }
  return null;
}

export async function confirmPastBookingProceed(message = PAST_BOOKING_WARNING) {
  return window.confirm(`${message}\n\nContinue saving this appointment?`);
}

export async function withPastBookingAcknowledgement({
  scheduleDate,
  timeStr,
  timezone,
  body,
  request,
}) {
  const payload = { ...body };
  if (!isInternalPastScheduled({ scheduleDate, timeStr, timezone })) {
    return request(payload);
  }
  if (!payload.past_booking_acknowledged) {
    if (!(await confirmPastBookingProceed())) {
      return { cancelled: true };
    }
    payload.past_booking_acknowledged = true;
  }
  try {
    const result = await request(payload);
    return { result };
  } catch (error) {
    const pastMsg = parsePastBookingError(error?.response?.data?.detail);
    if (pastMsg && !payload.past_booking_acknowledged) {
      if (!(await confirmPastBookingProceed(pastMsg))) {
        return { cancelled: true };
      }
      return withPastBookingAcknowledgement({
        scheduleDate,
        timeStr,
        timezone,
        body: { ...body, past_booking_acknowledged: true },
        request,
      });
    }
    throw error;
  }
}
