/** Appointment schedule duration helpers (internal booking). */

export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function minutesToTime(totalMin) {
  const mins = Math.max(0, Math.round(totalMin));
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function durationFromStartEnd(startTime, endTime, fallback = 30) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null || end <= start) return fallback;
  return end - start;
}

export function endTimeFromStartDuration(startTime, durationMin) {
  const start = parseTimeToMinutes(startTime);
  if (start == null) return "";
  return minutesToTime(start + Number(durationMin || 0));
}

export function buildScheduledAt(dateStr, timeStr) {
  if (!dateStr || !timeStr) return "";
  return `${dateStr}T${timeStr}:00`;
}

export function isCustomDuration(current, treatmentDefault) {
  if (!treatmentDefault || !current) return false;
  return Number(current) !== Number(treatmentDefault);
}

export const DURATION_SOURCES = {
  TREATMENT_DEFAULT: "treatment_default",
  MANUAL_OVERRIDE: "manual_override",
  DRAG_SELECTION: "drag_selection",
};
