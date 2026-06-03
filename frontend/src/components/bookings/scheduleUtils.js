/** Time helpers shared by schedule grid and overtime modal. */

export function minutesToTimeLabel(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function formatWorkWindows(effective) {
  const windows = effective?.work_windows || [];
  if (!windows.length) return "—";
  return windows
    .map((w) => `${minutesToTimeLabel(w.start)} – ${minutesToTimeLabel(w.end)}`)
    .join(", ");
}

export function formatBookingListDate(d) {
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export const OVERTIME_REASONS = [
  "Patient request",
  "Emergency",
  "Schedule exception",
  "Manager approved",
  "Other",
];
