/** Time helpers shared by schedule grid and overtime modal. */

export const SCHEDULE_ORIENTATION_KEY = "clinicos_schedule_orientation_v1";

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

export function resolveClinicTimezone(clinic) {
  return clinic?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Current date (YYYY-MM-DD) and minutes-since-midnight in clinic timezone. */
export function getClinicNowParts(timezone, now = new Date()) {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((p) => [p.type, p.value]),
  );
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parseInt(parts.hour, 10) || 0;
  const minute = parseInt(parts.minute, 10) || 0;
  return { dateStr, minutes: hour * 60 + minute };
}

/**
 * Whether an empty slot is in the past.
 * - Past dates: all slots past
 * - Future dates: none past
 * - Today: slots before current clinic-local time are past
 */
export function isPastEmptySlot({ scheduleDate, slotMin, timezone, now = new Date() }) {
  const { dateStr: todayStr, minutes: nowMin } = getClinicNowParts(timezone, now);
  if (scheduleDate < todayStr) return true;
  if (scheduleDate > todayStr) return false;
  return slotMin < nowMin;
}

/** Add calendar days to a YYYY-MM-DD string (UTC-safe). */
export function addDaysToDateStr(dateStr, days) {
  const base = new Date(`${dateStr}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Rolling date strings from clinic-local today (inclusive). */
export function daysFromClinicToday(timezone, count = 14, now = new Date()) {
  const { dateStr } = getClinicNowParts(timezone, now);
  return Array.from({ length: count }, (_, i) => addDaysToDateStr(dateStr, i));
}

export function isPastScheduleDate(scheduleDate, timezone, now = new Date()) {
  const { dateStr: todayStr } = getClinicNowParts(timezone, now);
  return scheduleDate < todayStr;
}

/** Filter public booking slots to future, selectable times only. */
export function filterPublicBookingSlots(slots, scheduleDate, timezone, now = new Date()) {
  if (isPastScheduleDate(scheduleDate, timezone, now)) return [];
  const { dateStr: todayStr, minutes: nowMin } = getClinicNowParts(timezone, now);
  const isToday = scheduleDate === todayStr;
  return (slots || []).filter((slot) => {
    if (slot.past) return false;
    if (!isToday) return true;
    const match = (slot.label || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return true;
    const slotMin = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    return slotMin >= nowMin;
  });
}

export function loadScheduleOrientation() {
  try {
    const v = localStorage.getItem(SCHEDULE_ORIENTATION_KEY);
    return v === "vertical" ? "vertical" : "horizontal";
  } catch {
    return "horizontal";
  }
}

export function saveScheduleOrientation(orientation) {
  try {
    localStorage.setItem(SCHEDULE_ORIENTATION_KEY, orientation);
  } catch {
    /* ignore */
  }
}

export function hhmmToMin(s) {
  if (!s || !s.includes(":")) return null;
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function minToHhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Mirrors backend staff_scheduling.slot_fits */
export function staffSlotFits(effective, slotStart, slotEnd) {
  if (!effective?.is_working) {
    return { available: false, reason: "Unavailable" };
  }
  const workWindows = (effective.work_windows || []).map((w) => [w.start, w.end]);
  const blockRanges = (effective.block_ranges || []).map((b) => [b.start, b.end]);
  if (!workWindows.length) {
    return { available: false, reason: "Unavailable" };
  }
  const inWork = workWindows.some(([a, b]) => a <= slotStart && slotEnd <= b);
  if (!inWork) {
    return { available: false, reason: "Outside working hours" };
  }
  for (const [b0, b1] of blockRanges) {
    if (slotEnd > b0 && slotStart < b1) {
      return { available: false, reason: "Unavailable" };
    }
  }
  return { available: true, reason: "" };
}

/**
 * Resolve slot interaction state for schedule grid cells.
 * Existing bookings are handled separately (always clickable for details).
 */
export function resolveEmptySlotState({
  scheduleDate,
  slotMin,
  slotEnd,
  timezone,
  effective,
  occupied,
  canManage,
  canBookSlots,
  canCreateOvertime,
  staffName,
  timeStr,
}) {
  const canBook = canBookSlots ?? canManage;
  const past = isPastEmptySlot({ scheduleDate, slotMin, timezone });
  const { available, reason } = staffSlotFits(effective, slotMin, slotEnd);
  const isOutsideHours = !available && reason === "Outside working hours";

  if (occupied) {
    return {
      kind: "occupied",
      clickable: false,
      title: "Booked",
      past: false,
    };
  }

  if (past) {
    if (canBook) {
      return {
        kind: "past",
        clickable: true,
        title: "Past time slot. Internal users can still create or edit appointments.",
        past: true,
      };
    }
    return {
      kind: "past",
      clickable: false,
      title: "Past time",
      past: true,
    };
  }

  if (canBook && available) {
    return {
      kind: "available",
      clickable: true,
      title: `Book ${staffName} at ${timeStr}`,
      past: false,
    };
  }

  if (canBook && canCreateOvertime && effective?.is_working && isOutsideHours) {
    return {
      kind: "overtime",
      clickable: true,
      title: "Outside working hours — overtime appointment",
      past: false,
    };
  }

  return {
    kind: "disabled",
    clickable: false,
    title: reason || "Unavailable",
    past: false,
  };
}

/** Whether an empty schedule cell can be clicked or drag-selected internally. */
export function isEmptySlotInteractive(state) {
  if (!state?.clickable) return false;
  return state.kind === "available" || state.kind === "past" || state.kind === "overtime";
}
