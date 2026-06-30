/** Drag-to-select time range helpers for the appointment schedule grid. */

import { resolveEmptySlotState } from "./scheduleUtils";

export const SCHEDULE_DRAG_THRESHOLD_PX = 8;

export function normalizeDragRange(anchorMin, targetMin, interval) {
  const startMin = Math.min(anchorMin, targetMin);
  const endMinExclusive = Math.max(anchorMin, targetMin) + interval;
  return { startMin, endMinExclusive };
}

export function slotCountInRange(startMin, endMinExclusive, interval) {
  if (endMinExclusive <= startMin) return 0;
  return Math.round((endMinExclusive - startMin) / interval);
}

export function isDragRangeSelection(moved, startMin, endMinExclusive, interval) {
  return moved && slotCountInRange(startMin, endMinExclusive, interval) > 1;
}

export function eachSlotInRange(startMin, endMinExclusive, interval, fn) {
  for (let m = startMin; m < endMinExclusive; m += interval) {
    if (fn(m, m + interval) === false) return false;
  }
  return true;
}

export function isSlotSelectableForDrag({
  scheduleDate,
  slotMin,
  slotEnd,
  timezone,
  effective,
  occupied,
  canManage,
}) {
  if (!canManage || occupied) return false;
  const state = resolveEmptySlotState({
    scheduleDate,
    slotMin,
    slotEnd,
    timezone,
    effective,
    occupied,
    canManage,
    canCreateOvertime: false,
    staffName: "",
    timeStr: "",
  });
  return state.kind === "available";
}

export function clipDragRangeToValid({ startMin, endMinExclusive, interval, isSlotValid }) {
  let end = endMinExclusive;
  while (end > startMin) {
    const valid = eachSlotInRange(startMin, end, interval, (sm, se) => isSlotValid(sm, se));
    if (valid) return { startMin, endMinExclusive: end };
    end -= interval;
  }
  return null;
}

export function slotInDragPreview(slotMin, preview, interval) {
  if (!preview) return false;
  return slotMin >= preview.startMin && slotMin < preview.endMinExclusive;
}
