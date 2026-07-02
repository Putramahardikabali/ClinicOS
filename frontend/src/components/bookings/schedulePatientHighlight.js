import { isTimeBlockBooking } from "@/components/bookings/scheduleBookingIndicators";

/** @typedef {{ patientId: string, patientName: string, totalCount?: number, visibleCount?: number, hiddenCount?: number }} PatientHighlightState */

export function isHighlightableBooking(booking) {
  return Boolean(booking?.patient_id) && !isTimeBlockBooking(booking);
}

export function bookingMatchesPatientHighlight(booking, highlight, scheduleDate) {
  if (!highlight?.patientId || !booking?.patient_id) return false;
  if (isTimeBlockBooking(booking)) return false;
  const day = (booking.scheduled_at || "").slice(0, 10);
  if (scheduleDate && day && day !== scheduleDate) return false;
  return booking.patient_id === highlight.patientId;
}

export function countVisiblePatientBookings(bookings, patientId, scheduleDate) {
  return (bookings || []).filter(
    (b) => bookingMatchesPatientHighlight(b, { patientId }, scheduleDate),
  ).length;
}

export function patientHighlightBannerText(highlight) {
  if (!highlight) return "";
  const n = highlight.visibleCount ?? highlight.totalCount ?? 0;
  const name = highlight.patientName || "Patient";
  if (n <= 1) return `Highlighting: ${name}`;
  return `Highlighting: ${name} · ${n} bookings`;
}
