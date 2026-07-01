import {
  isTimeBlockBooking,
  resolveScheduleDisplayStatus,
} from "@/components/bookings/scheduleBookingIndicators";

/** Status filter options shared by schedule view and bookings page. */
export const SCHEDULE_STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "booked", label: "Booked" },
  { value: "confirmed", label: "Confirmed" },
  { value: "checked_in", label: "Checked In" },
  { value: "treatment_started", label: "Treatment Started" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No Show" },
  { value: "block_out", label: "Block Out Time" },
  { value: "unavailable", label: "Unavailable Time Slot" },
];

const DISPLAY_ONLY_FILTERS = new Set(["treatment_started", "closed", "unavailable"]);

export function resolveApiStatusFilter(statusFilter) {
  if (!statusFilter) return null;
  if (DISPLAY_ONLY_FILTERS.has(statusFilter)) return null;
  if (statusFilter === "block_out") return "blocked";
  return statusFilter;
}

export function bookingDisplayStatus(booking) {
  return booking?.schedule_meta?.display_status || resolveScheduleDisplayStatus(booking);
}

export function bookingMatchesScheduleStatusFilter(booking, statusFilter) {
  if (!statusFilter) return true;
  if (statusFilter === "block_out") {
    return isTimeBlockBooking(booking) || bookingDisplayStatus(booking) === "block_out";
  }
  const display = bookingDisplayStatus(booking);
  if (DISPLAY_ONLY_FILTERS.has(statusFilter)) {
    return display === statusFilter;
  }
  return display === statusFilter || (booking?.status || "").toLowerCase() === statusFilter;
}

export function filterBookingsByScheduleStatus(bookings, statusFilter) {
  if (!statusFilter) return bookings || [];
  return (bookings || []).filter((b) => bookingMatchesScheduleStatusFilter(b, statusFilter));
}
