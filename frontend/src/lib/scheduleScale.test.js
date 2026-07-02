import {
  applyFitModeToState,
  buildScheduleMetrics,
  computeFitMetrics,
  computeFitScales,
  DEFAULT_SCALE_STATE,
  resolveTimeLabelStep,
  SCHEDULE_FIT_CHROME,
  SCHEDULE_FIT_MODES,
  SCHEDULE_FIT_SLOT_LIMITS,
  SCHEDULE_SCALE_DEFAULTS,
  shouldShowVerticalTimeLabel,
} from "./scheduleScale";

describe("scheduleScale", () => {
  it("uses defaults when not fullscreen", () => {
    expect(buildScheduleMetrics({ rowHRatio: 0.5 }, false)).toMatchObject({
      rowH: SCHEDULE_SCALE_DEFAULTS.rowH,
      slotPx: SCHEDULE_SCALE_DEFAULTS.slotPx,
      fitMode: SCHEDULE_FIT_MODES.default,
      compact: false,
    });
  });

  it("scales metrics in fullscreen", () => {
    const m = buildScheduleMetrics({ ...DEFAULT_SCALE_STATE, rowHRatio: 0.5, slotPxRatio: 0.75 }, true);
    expect(m.rowH).toBe(26);
    expect(m.slotPx).toBe(24);
  });

  it("applies stored fit slot height in focus mode", () => {
    const m = buildScheduleMetrics({
      fitMode: SCHEDULE_FIT_MODES.fitHeight,
      slotHeightPx: 11,
      rowHRatio: 11 / SCHEDULE_SCALE_DEFAULTS.rowH,
    }, true);
    expect(m.slotHeight).toBe(11);
    expect(m.rowH).toBe(11);
    expect(m.compact).toBe(true);
  });

  it("computes compact fit slot height for vertical orientation", () => {
    const metrics = computeFitMetrics({
      orientation: "vertical",
      viewportWidth: 1200,
      viewportHeight: 700,
      slotCount: 60,
      staffCount: 4,
    });
    expect(metrics.slotHeightPx).toBeGreaterThanOrEqual(SCHEDULE_FIT_SLOT_LIMITS.minSlotHeight);
    expect(metrics.slotHeightPx).toBeLessThanOrEqual(SCHEDULE_FIT_SLOT_LIMITS.maxSlotHeight);
    const totalHeight = SCHEDULE_FIT_CHROME.verticalStickyHeader + 60 * metrics.slotHeightPx;
    expect(totalHeight).toBeLessThanOrEqual(710);
  });

  it("fits 60 ten-minute slots into a 700px viewport vertically", () => {
    const metrics = computeFitMetrics({
      orientation: "vertical",
      viewportWidth: 1200,
      viewportHeight: 700,
      slotCount: 60,
      staffCount: 4,
    });
    expect(metrics.slotHeightPx).toBeCloseTo((700 - SCHEDULE_FIT_CHROME.verticalStickyHeader) / 60, 0);
  });

  it("computes fit scales for horizontal orientation with group headers", () => {
    const metrics = computeFitMetrics({
      orientation: "horizontal",
      viewportWidth: 1400,
      viewportHeight: 700,
      slotCount: 60,
      staffCount: 5,
      staffGroupCount: 2,
    });
    expect(metrics.rowHRatio).toBeGreaterThan(0);
    expect(metrics.slotWidthPx).toBeGreaterThanOrEqual(SCHEDULE_FIT_SLOT_LIMITS.minSlotWidth);
    expect(metrics.slotWidthPx).toBeLessThanOrEqual(SCHEDULE_FIT_SLOT_LIMITS.maxSlotWidth);
  });

  it("computeFitScales remains compatible", () => {
    const ratios = computeFitScales({
      orientation: "vertical",
      viewportWidth: 1200,
      viewportHeight: 800,
      slotCount: 22,
      staffCount: 4,
    });
    expect(ratios.rowHRatio).toBeLessThan(1);
    expect(ratios.staffColRatio).toBeGreaterThan(0);
  });

  it("thins vertical time labels when rows are compact", () => {
    expect(resolveTimeLabelStep(30, 40)).toBe(30);
    expect(resolveTimeLabelStep(30, 26)).toBe(30);
    expect(resolveTimeLabelStep(10, 11)).toBe(30);
    expect(resolveTimeLabelStep(10, 8)).toBe(60);
    expect(shouldShowVerticalTimeLabel(600, 540, 30)).toBe(true);
    expect(shouldShowVerticalTimeLabel(545, 540, 30)).toBe(false);
  });

  it("reset clears fit mode", () => {
    expect(applyFitModeToState(SCHEDULE_FIT_MODES.default, {}, { rowHRatio: 0.4, slotHeightPx: 10 })).toEqual(DEFAULT_SCALE_STATE);
  });

  it("fit height stores absolute slot height", () => {
    const fit = computeFitMetrics({
      orientation: "vertical",
      viewportWidth: 1000,
      viewportHeight: 700,
      slotCount: 60,
      staffCount: 3,
    });
    const state = applyFitModeToState(SCHEDULE_FIT_MODES.fitHeight, fit, DEFAULT_SCALE_STATE);
    expect(state.slotHeightPx).toBe(fit.slotHeightPx);
    expect(state.fitMode).toBe(SCHEDULE_FIT_MODES.fitHeight);
  });
});
