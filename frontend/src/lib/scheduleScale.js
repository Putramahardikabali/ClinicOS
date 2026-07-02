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
  minRowH: 20,
  maxRowH: 80,
  minStaffColW: 84,
  maxStaffColW: 200,
};

/** Compact fit-mode limits for time-slot rows/columns (px). */
export const SCHEDULE_FIT_SLOT_LIMITS = {
  minSlotHeight: 7,
  maxSlotHeight: 16,
  minSlotWidth: 7,
  maxSlotWidth: 16,
};

/** Sticky chrome inside the schedule grid viewport (px). */
export const SCHEDULE_FIT_CHROME = {
  horizontalTimeHeader: 32,
  horizontalGroupHeader: 28,
  verticalStickyHeader: 82,
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
  slotHeightPx: null,
  slotWidthPx: null,
  staffColPx: null,
  slotPxRatio: 1,
  rowHRatio: 1,
  staffColRatio: 1,
};

const MANUAL_STEP_PX = 1;

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
  return ctx || buildScheduleMetrics(DEFAULT_SCALE_STATE, false);
}

function clampRatio(ratio, minPx, maxPx, base) {
  const minR = minPx / base;
  const maxR = maxPx / base;
  return Math.min(maxR, Math.max(minR, ratio));
}

export function clampScheduleMetric(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFitSlotHeight(px) {
  const { minSlotHeight, maxSlotHeight } = SCHEDULE_FIT_SLOT_LIMITS;
  return Math.round(Math.min(maxSlotHeight, Math.max(minSlotHeight, px)) * 10) / 10;
}

function clampFitSlotWidth(px) {
  const { minSlotWidth, maxSlotWidth } = SCHEDULE_FIT_SLOT_LIMITS;
  return Math.round(Math.min(maxSlotWidth, Math.max(minSlotWidth, px)) * 10) / 10;
}

function isFitActive(fitMode) {
  return fitMode && fitMode !== SCHEDULE_FIT_MODES.default;
}

function usesFitSlotHeight(fitMode) {
  return [SCHEDULE_FIT_MODES.fitHeight, SCHEDULE_FIT_MODES.fitScreen, SCHEDULE_FIT_MODES.manual].includes(fitMode);
}

function usesFitSlotWidth(fitMode) {
  return [SCHEDULE_FIT_MODES.fitWidth, SCHEDULE_FIT_MODES.fitScreen, SCHEDULE_FIT_MODES.manual].includes(fitMode);
}

export function buildScheduleMetrics(scaleState, isFocusMode) {
  if (!isFocusMode) {
    const d = SCHEDULE_SCALE_DEFAULTS;
    return {
      ...d,
      slotHeight: d.rowH,
      slotWidth: d.slotPx,
      compact: false,
      fitMode: SCHEDULE_FIT_MODES.default,
    };
  }

  const d = SCHEDULE_SCALE_DEFAULTS;
  const l = SCHEDULE_SCALE_LIMITS;
  const state = scaleState || DEFAULT_SCALE_STATE;
  const fitMode = state.fitMode || SCHEDULE_FIT_MODES.default;
  const fitActive = isFitActive(fitMode);

  let slotHeight = state.slotHeightPx != null
    ? state.slotHeightPx
    : clampScheduleMetric(d.rowH * (state.rowHRatio || 1), l.minRowH, l.maxRowH);

  let slotWidth = state.slotWidthPx != null
    ? state.slotWidthPx
    : clampScheduleMetric(d.slotPx * (state.slotPxRatio || 1), l.minSlotPx, l.maxSlotPx);

  let staffColW = state.staffColPx != null
    ? state.staffColPx
    : clampScheduleMetric(d.staffColW * (state.staffColRatio || 1), l.minStaffColW, l.maxStaffColW);

  if (fitActive && usesFitSlotHeight(fitMode) && state.slotHeightPx != null) {
    slotHeight = state.slotHeightPx;
  }
  if (fitActive && usesFitSlotWidth(fitMode) && state.slotWidthPx != null) {
    slotWidth = state.slotWidthPx;
  }

  const compact = fitActive && (slotHeight <= 16 || slotWidth <= 16);

  return {
    slotPx: slotWidth,
    rowH: slotHeight,
    slotHeight,
    slotWidth,
    staffColW,
    timeColW: d.timeColW,
    compact,
    fitMode,
  };
}

export function buildScheduleCssVars(metrics) {
  const m = metrics || SCHEDULE_SCALE_DEFAULTS;
  const slotHeight = m.slotHeight ?? m.rowH ?? SCHEDULE_SCALE_DEFAULTS.rowH;
  const slotWidth = m.slotWidth ?? m.slotPx ?? SCHEDULE_SCALE_DEFAULTS.slotPx;
  return {
    "--schedule-slot-height": `${slotHeight}px`,
    "--schedule-slot-width": `${slotWidth}px`,
    "--schedule-staff-col-width": `${m.staffColW ?? SCHEDULE_SCALE_DEFAULTS.staffColW}px`,
    "--schedule-time-col-width": `${m.timeColW ?? SCHEDULE_SCALE_DEFAULTS.timeColW}px`,
  };
}

export function verticalSlotStyle(compact = false) {
  return {
    height: "var(--schedule-slot-height)",
    minHeight: "var(--schedule-slot-height)",
    maxHeight: "var(--schedule-slot-height)",
    padding: compact ? 0 : undefined,
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
      slotHeightPx: parsed.slotHeightPx != null ? Number(parsed.slotHeightPx) : null,
      slotWidthPx: parsed.slotWidthPx != null ? Number(parsed.slotWidthPx) : null,
      staffColPx: parsed.staffColPx != null ? Number(parsed.staffColPx) : null,
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
 * Compute absolute slot dimensions to fit the schedule grid into the viewport.
 * @param {"horizontal"|"vertical"} orientation
 */
export function computeFitMetrics({
  orientation,
  viewportWidth,
  viewportHeight,
  slotCount,
  staffCount,
  staffGroupCount = 1,
}) {
  const d = SCHEDULE_SCALE_DEFAULTS;
  const l = SCHEDULE_SCALE_LIMITS;
  const chrome = SCHEDULE_FIT_CHROME;
  const slots = Math.max(1, slotCount || 1);
  const staff = Math.max(1, staffCount || 1);
  const groups = Math.max(1, staffGroupCount || 1);
  const availH = Math.max(80, viewportHeight);
  const availW = Math.max(80, viewportWidth);

  let slotHeightPx = d.rowH;
  let slotWidthPx = d.slotPx;
  let staffColPx = d.staffColW;

  if (orientation === "vertical") {
    const gridBodyHeight = Math.max(40, availH - chrome.verticalStickyHeader);
    slotHeightPx = clampFitSlotHeight(gridBodyHeight / slots);
    const totalStaffW = staff * d.staffColW;
    staffColPx = clampScheduleMetric(
      (availW - d.timeColW) / staff,
      l.minStaffColW,
      l.maxStaffColW,
    );
  } else {
    const gridBodyHeight = Math.max(40, availH - chrome.horizontalTimeHeader);
    const staffBlockH = groups * chrome.horizontalGroupHeader + staff * d.rowH;
    slotHeightPx = clampScheduleMetric(
      (gridBodyHeight / staffBlockH) * d.rowH,
      l.minRowH,
      l.maxRowH,
    );
    const gridBodyWidth = Math.max(40, availW - d.staffColW);
    slotWidthPx = clampFitSlotWidth(gridBodyWidth / slots);
  }

  return {
    slotHeightPx,
    slotWidthPx,
    staffColPx,
    rowHRatio: slotHeightPx / d.rowH,
    slotPxRatio: slotWidthPx / d.slotPx,
    staffColRatio: staffColPx / d.staffColW,
  };
}

/** @deprecated Use computeFitMetrics */
export function computeFitScales(args) {
  const m = computeFitMetrics(args);
  return {
    rowHRatio: m.rowHRatio,
    slotPxRatio: m.slotPxRatio,
    staffColRatio: m.staffColRatio,
  };
}

/** Label step in minutes when rows are compact in vertical view. */
export function resolveTimeLabelStep(interval, rowHeightPx) {
  const iv = Math.max(5, Number(interval) || 30);
  if (rowHeightPx >= 36) return iv;
  if (rowHeightPx >= 20) return Math.max(iv, 15);
  if (rowHeightPx >= 10) return Math.max(iv, 30);
  return Math.max(iv, 60);
}

export function shouldShowVerticalTimeLabel(slotMin, openMin, labelStep) {
  return (slotMin - openMin) % labelStep === 0;
}

export function applyFitModeToState(mode, fitMetrics, prev = DEFAULT_SCALE_STATE) {
  const base = { ...prev, fitMode: mode };
  if (mode === SCHEDULE_FIT_MODES.default) {
    return { ...DEFAULT_SCALE_STATE };
  }
  if (mode === SCHEDULE_FIT_MODES.fitHeight) {
    return {
      ...base,
      slotHeightPx: fitMetrics.slotHeightPx,
      rowHRatio: fitMetrics.rowHRatio,
    };
  }
  if (mode === SCHEDULE_FIT_MODES.fitWidth) {
    return {
      ...base,
      slotWidthPx: fitMetrics.slotWidthPx,
      staffColPx: fitMetrics.staffColPx,
      slotPxRatio: fitMetrics.slotPxRatio,
      staffColRatio: fitMetrics.staffColRatio,
    };
  }
  if (mode === SCHEDULE_FIT_MODES.fitScreen) {
    return {
      ...base,
      slotHeightPx: fitMetrics.slotHeightPx,
      slotWidthPx: fitMetrics.slotWidthPx,
      staffColPx: fitMetrics.staffColPx,
      rowHRatio: fitMetrics.rowHRatio,
      slotPxRatio: fitMetrics.slotPxRatio,
      staffColRatio: fitMetrics.staffColRatio,
    };
  }
  return base;
}

export function adjustManualScale(prev, axis, delta, metrics) {
  const d = SCHEDULE_SCALE_DEFAULTS;
  const l = SCHEDULE_SCALE_LIMITS;
  const fitL = SCHEDULE_FIT_SLOT_LIMITS;
  const next = { ...prev, fitMode: SCHEDULE_FIT_MODES.manual };
  const step = delta * MANUAL_STEP_PX;

  if (axis === "rowH") {
    const current = prev.slotHeightPx ?? metrics?.slotHeight ?? d.rowH * (prev.rowHRatio || 1);
    const min = fitL.minSlotHeight;
    const max = l.maxRowH;
    next.slotHeightPx = clampScheduleMetric(current + step, min, max);
    next.rowHRatio = next.slotHeightPx / d.rowH;
  } else if (axis === "slotPx") {
    const current = prev.slotWidthPx ?? metrics?.slotWidth ?? d.slotPx * (prev.slotPxRatio || 1);
    const min = fitL.minSlotWidth;
    const max = l.maxSlotPx;
    next.slotWidthPx = clampScheduleMetric(current + step, min, max);
    next.slotPxRatio = next.slotWidthPx / d.slotPx;
  } else if (axis === "staffCol") {
    const current = prev.staffColPx ?? metrics?.staffColW ?? d.staffColW * (prev.staffColRatio || 1);
    next.staffColPx = clampScheduleMetric(
      current + step * 4,
      l.minStaffColW,
      l.maxStaffColW,
    );
    next.staffColRatio = next.staffColPx / d.staffColW;
  }
  return next;
}
