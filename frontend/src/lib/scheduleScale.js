import { createContext, useContext } from "react";

export const SCHEDULE_SCALE_STORAGE_KEY = "clinicOS.scheduleFullscreenScale";

export const SCHEDULE_SCALE_DEFAULTS = {
  slotPx: 32,
  rowH: 52,
  staffColW: 132,
  timeColW: 76,
};

export const SCHEDULE_SCALE_LIMITS = {
  minSlotPx: 18,
  maxSlotPx: 52,
  minRowH: 28,
  maxRowH: 80,
  minStaffColW: 84,
  maxStaffColW: 200,
};

export const SCHEDULE_FIT_MODES = {
  default: "default",
  fitHeight: "fit-height",
  fitWidth: "fit-width",
  fitScreen: "fit-screen",
  manual: "manual",
};

export const DEFAULT_SCALE_STATE = {
  fitMode: SCHEDULE_FIT_MODES.default,
  slotPxRatio: 1,
  rowHRatio: 1,
  staffColRatio: 1,
};

const MANUAL_STEP = 0.08;

const ScheduleMetricsContext = createContext(null);

export function ScheduleMetricsProvider({ value, children }) {
  return (
    <ScheduleMetricsContext.Provider value={value}>
      {children}
    </ScheduleMetricsContext.Provider>
  );
}

export function useScheduleMetrics() {
  const ctx = useContext(ScheduleMetricsContext);
  return ctx || SCHEDULE_SCALE_DEFAULTS;
}

function clampRatio(ratio, minPx, maxPx, base) {
  const minR = minPx / base;
  const maxR = maxPx / base;
  return Math.min(maxR, Math.max(minR, ratio));
}

export function clampScheduleMetric(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function buildScheduleMetrics(scaleState, isFocusMode) {
  if (!isFocusMode) {
    return { ...SCHEDULE_SCALE_DEFAULTS, fitMode: SCHEDULE_FIT_MODES.default };
  }
  const d = SCHEDULE_SCALE_DEFAULTS;
  const l = SCHEDULE_SCALE_LIMITS;
  const state = scaleState || DEFAULT_SCALE_STATE;
  return {
    slotPx: clampScheduleMetric(d.slotPx * state.slotPxRatio, l.minSlotPx, l.maxSlotPx),
    rowH: clampScheduleMetric(d.rowH * state.rowHRatio, l.minRowH, l.maxRowH),
    staffColW: clampScheduleMetric(d.staffColW * state.staffColRatio, l.minStaffColW, l.maxStaffColW),
    timeColW: d.timeColW,
    fitMode: state.fitMode || SCHEDULE_FIT_MODES.default,
  };
}

export function loadScheduleScaleState() {
  if (typeof window === "undefined") return { ...DEFAULT_SCALE_STATE };
  try {
    const raw = window.localStorage.getItem(SCHEDULE_SCALE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SCALE_STATE };
    const parsed = JSON.parse(raw);
    return {
      fitMode: parsed.fitMode || SCHEDULE_FIT_MODES.default,
      slotPxRatio: Number(parsed.slotPxRatio) || 1,
      rowHRatio: Number(parsed.rowHRatio) || 1,
      staffColRatio: Number(parsed.staffColRatio) || 1,
    };
  } catch {
    return { ...DEFAULT_SCALE_STATE };
  }
}

export function saveScheduleScaleState(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCHEDULE_SCALE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

/**
 * Compute scale ratios to fit the schedule grid into the viewport.
 * @param {"horizontal"|"vertical"} orientation
 */
export function computeFitScales({
  orientation,
  viewportWidth,
  viewportHeight,
  slotCount,
  staffCount,
  headerChromeHeight = 88,
  headerChromeWidth = 16,
}) {
  const d = SCHEDULE_SCALE_DEFAULTS;
  const l = SCHEDULE_SCALE_LIMITS;
  const slots = Math.max(1, slotCount || 1);
  const staff = Math.max(1, staffCount || 1);
  const availH = Math.max(120, viewportHeight - headerChromeHeight);
  const availW = Math.max(120, viewportWidth - headerChromeWidth);

  let rowHRatio = 1;
  let slotPxRatio = 1;
  let staffColRatio = 1;

  if (orientation === "vertical") {
    const timeHeader = 82;
    const defaultTrackH = slots * d.rowH;
    rowHRatio = availH / (defaultTrackH + timeHeader);
    const defaultStaffW = staff * d.staffColW;
    staffColRatio = (availW - d.timeColW) / defaultStaffW;
  } else {
    const timeHeader = 36;
    const defaultRowsH = staff * d.rowH;
    rowHRatio = availH / (defaultRowsH + timeHeader);
    const defaultGridW = slots * d.slotPx;
    slotPxRatio = (availW - d.staffColW) / defaultGridW;
  }

  return {
    rowHRatio: clampRatio(rowHRatio, l.minRowH, l.maxRowH, d.rowH),
    slotPxRatio: clampRatio(slotPxRatio, l.minSlotPx, l.maxSlotPx, d.slotPx),
    staffColRatio: clampRatio(staffColRatio, l.minStaffColW, l.maxStaffColW, d.staffColW),
  };
}

export function applyFitModeToState(mode, ratios, prev = DEFAULT_SCALE_STATE) {
  const base = { ...prev, fitMode: mode };
  if (mode === SCHEDULE_FIT_MODES.default) {
    return { ...DEFAULT_SCALE_STATE };
  }
  if (mode === SCHEDULE_FIT_MODES.fitHeight) {
    return { ...base, rowHRatio: ratios.rowHRatio };
  }
  if (mode === SCHEDULE_FIT_MODES.fitWidth) {
    return {
      ...base,
      slotPxRatio: ratios.slotPxRatio,
      staffColRatio: ratios.staffColRatio,
    };
  }
  if (mode === SCHEDULE_FIT_MODES.fitScreen) {
    return {
      ...base,
      rowHRatio: ratios.rowHRatio,
      slotPxRatio: ratios.slotPxRatio,
      staffColRatio: ratios.staffColRatio,
    };
  }
  return base;
}

export function adjustManualScale(prev, axis, delta) {
  const next = { ...prev, fitMode: SCHEDULE_FIT_MODES.manual };
  if (axis === "rowH") {
    next.rowHRatio = clampRatio(
      (prev.rowHRatio || 1) + delta * MANUAL_STEP,
      SCHEDULE_SCALE_LIMITS.minRowH,
      SCHEDULE_SCALE_LIMITS.maxRowH,
      SCHEDULE_SCALE_DEFAULTS.rowH,
    );
  } else if (axis === "slotPx") {
    next.slotPxRatio = clampRatio(
      (prev.slotPxRatio || 1) + delta * MANUAL_STEP,
      SCHEDULE_SCALE_LIMITS.minSlotPx,
      SCHEDULE_SCALE_LIMITS.maxSlotPx,
      SCHEDULE_SCALE_DEFAULTS.slotPx,
    );
  } else if (axis === "staffCol") {
    next.staffColRatio = clampRatio(
      (prev.staffColRatio || 1) + delta * MANUAL_STEP,
      SCHEDULE_SCALE_LIMITS.minStaffColW,
      SCHEDULE_SCALE_LIMITS.maxStaffColW,
      SCHEDULE_SCALE_DEFAULTS.staffColW,
    );
  }
  return next;
}
