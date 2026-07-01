export function bookingMatchesScheduleSearch(booking, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    booking?.patient_name,
    booking?.patient_phone,
    booking?.treatment,
    booking?.block_reason,
    booking?.patient_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function countSearchMatches(bookings, query) {
  const q = (query || "").trim();
  if (!q) return 0;
  return (bookings || []).filter((b) => bookingMatchesScheduleSearch(b, q)).length;
}
