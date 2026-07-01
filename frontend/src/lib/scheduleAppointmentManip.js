/** Drag / resize helpers for internal schedule appointment manipulation. */

import { minToHhmm } from "@/components/bookings/scheduleUtils";

export const MIN_APPOINTMENT_DURATION_MIN = 15;
export const APPT_MANIP_THRESHOLD_PX = 6;

export function snapMinutesToInterval(minutes, interval) {
  const iv = Math.max(5, Number(interval) || 30);
  return Math.round(minutes / iv) * iv;
}

export function clampDuration(durationMin, interval, minDuration = MIN_APPOINTMENT_DURATION_MIN) {
  const minDur = Math.max(minDuration, interval);
  return Math.max(minDur, Math.round(durationMin / interval) * interval);
}

export function bookingEndMinFromStart(startMin, durationMin) {
  return startMin + (durationMin || 30);
}

export function buildScheduledAtIso(dateStr, startMin) {
  return `${dateStr}T${minToHhmm(startMin)}:00`;
}

export function formatScheduleTimeRange(dateStr, startMin, durationMin) {
  const endMin = bookingEndMinFromStart(startMin, durationMin);
  return `${minToHhmm(startMin)} – ${minToHhmm(endMin)}`;
}

export function pointerToSnappedStartMin(trackEl, clientX, clientY, { openMin, closeMin, interval, orientation, slotPx, rowH }) {
  if (!trackEl) return null;
  const rect = trackEl.getBoundingClientRect();
  let slotIndex;
  if (orientation === "vertical") {
    const py = clientY - rect.top;
    slotIndex = Math.floor(py / rowH);
  } else {
    const px = clientX - rect.left;
    slotIndex = Math.floor(px / slotPx);
  }
  const raw = openMin + slotIndex * interval;
  const snapped = snapMinutesToInterval(raw, interval);
  if (snapped < openMin) return openMin;
  const maxStart = closeMin - interval;
  if (snapped > maxStart) return maxStart;
  return snapped;
}

export function pointerToSnappedEndMin(trackEl, clientX, clientY, { openMin, closeMin, interval, orientation, slotPx, rowH }) {
  const startSlot = pointerToSnappedStartMin(trackEl, clientX, clientY, {
    openMin, closeMin, interval, orientation, slotPx, rowH,
  });
  if (startSlot == null) return null;
  return Math.min(closeMin, startSlot + interval);
}

export function resolveStaffIdFromPointer(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const track = el?.closest?.("[data-schedule-track]");
  return track?.getAttribute?.("data-staff-id") || null;
}

export function resolveTrackFromPointer(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  return el?.closest?.("[data-schedule-track]") || null;
}

function bookingStartMinLocal(scheduledAt) {
  const d = new Date(scheduledAt);
  return d.getHours() * 60 + d.getMinutes();
}

function staffIdsFromBooking(booking) {
  const ids = [];
  if (booking.performer_id) ids.push(booking.performer_id);
  for (const p of booking.performers || []) {
    if (p.staff_id && !ids.includes(p.staff_id)) ids.push(p.staff_id);
  }
  return ids;
}

function rangesOverlap(a0, a1, b0, b1) {
  return a1 > b0 && a0 < b1;
}

const OCCUPYING = new Set(["booked", "confirmed", "checked_in", "blocked", "pending_payment"]);

export function findLocalScheduleConflicts(bookings, { staffId, startMin, durationMin, excludeBookingId }) {
  if (!staffId) return [];
  const endMin = bookingEndMinFromStart(startMin, durationMin);
  const conflicts = [];
  for (const b of bookings) {
    if (b.id === excludeBookingId) continue;
    if (!OCCUPYING.has(b.status)) continue;
    if (!staffIdsFromBooking(b).includes(staffId)) continue;
    const bs = bookingStartMinLocal(b.scheduled_at);
    const be = bookingEndMinFromStart(bs, b.duration_min || 30);
    if (!rangesOverlap(startMin, endMin, bs, be)) continue;
    const blocked = b.status === "blocked" || b.booking_type === "block";
    conflicts.push({
      id: b.id,
      patient_name: b.patient_name || "",
      treatment: blocked ? "Blocked" : (b.treatment || ""),
      status: b.status || "",
      scheduled_at: b.scheduled_at,
      duration_min: b.duration_min || 30,
      is_block: blocked,
    });
  }
  return conflicts;
}

export function canManipulateAppointment(booking, canManage) {
  if (!canManage || !booking) return false;
  if (booking.booking_type === "block" || booking.status === "blocked") return false;
  if (["cancelled", "completed", "no_show"].includes(booking.status)) return false;
  return true;
}

export function describeScheduleChange(origin, proposed, staffById) {
  const staffChanged = origin.staffId !== proposed.staffId;
  const timeChanged = origin.startMin !== proposed.startMin;
  const durationChanged = origin.durationMin !== proposed.durationMin;
  let changeType = "moved";
  if (durationChanged && !timeChanged && !staffChanged) changeType = "resized";
  else if (staffChanged) changeType = "reassigned";
  else if (timeChanged || durationChanged) changeType = "moved";
  return {
    changeType,
    staffName: staffById[proposed.staffId]?.name || "—",
    oldStaffName: staffById[origin.staffId]?.name || "—",
    staffChanged,
    timeChanged,
    durationChanged,
  };
}
