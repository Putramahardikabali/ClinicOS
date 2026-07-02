import { minToHhmm } from "@/components/bookings/scheduleUtils";

export const SCHEDULE_INTERACTION_DEBUG_KEY = "scheduleInteractionDebug";

export function isScheduleInteractionDebugEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SCHEDULE_INTERACTION_DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function logScheduleInteractionDebug(payload) {
  if (!isScheduleInteractionDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info("[schedule-interaction]", payload);
}

export function readTrackMetrics(trackEl, fallback = {}) {
  if (!trackEl) {
    return {
      openMin: 0,
      closeMin: 0,
      interval: 30,
      orientation: "vertical",
      slotPx: fallback.slotPx ?? 32,
      rowH: fallback.rowH ?? 32,
    };
  }
  const style = typeof getComputedStyle !== "undefined" ? getComputedStyle(trackEl) : null;
  const slotHeightVar = style ? parseFloat(style.getPropertyValue("--schedule-slot-height")) : NaN;
  const slotWidthVar = style ? parseFloat(style.getPropertyValue("--schedule-slot-width")) : NaN;
  const rowH = Number(trackEl.getAttribute("data-row-h")) || slotHeightVar || fallback.rowH || 32;
  const slotPx = Number(trackEl.getAttribute("data-slot-px")) || slotWidthVar || fallback.slotPx || 32;
  return {
    openMin: Number(trackEl.getAttribute("data-open-min")),
    closeMin: Number(trackEl.getAttribute("data-close-min")),
    interval: Number(trackEl.getAttribute("data-interval")),
    orientation: trackEl.getAttribute("data-orientation") || fallback.orientation || "vertical",
    slotPx,
    rowH,
  };
}

/**
 * Hit-test pointer position within a single staff schedule track.
 */
export function hitTestTrackPointer(trackEl, clientX, clientY, fallbackMetrics = {}) {
  if (!trackEl) return null;
  const params = readTrackMetrics(trackEl, fallbackMetrics);
  const { openMin, closeMin, interval, orientation, slotPx, rowH } = params;
  if (Number.isNaN(openMin) || Number.isNaN(closeMin) || !interval) return null;

  const rect = trackEl.getBoundingClientRect();
  const staffId = trackEl.getAttribute("data-staff-id") || "";
  const maxSlots = Math.floor((closeMin - openMin) / interval);
  if (maxSlots <= 0) return null;

  let slotIndex;
  if (orientation === "vertical") {
    const py = clientY - rect.top;
    const effectiveRowH = rowH > 0 ? rowH : rect.height / maxSlots;
    slotIndex = Math.floor(py / effectiveRowH);
  } else {
    const px = clientX - rect.left;
    const effectiveSlotPx = slotPx > 0 ? slotPx : rect.width / maxSlots;
    slotIndex = Math.floor(px / effectiveSlotPx);
  }

  if (slotIndex < 0 || slotIndex >= maxSlots) return null;

  const slotMin = openMin + slotIndex * interval;
  const slotEnd = slotMin + interval;

  return {
    staffId,
    slotIndex,
    slotMin,
    slotEnd,
    timeStr: minToHhmm(slotMin),
    localX: clientX - rect.left,
    localY: clientY - rect.top,
    orientation,
    metrics: params,
  };
}
