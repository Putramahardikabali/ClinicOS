import {
  applyFitModeToState,
  buildScheduleMetrics,
  computeFitScales,
  DEFAULT_SCALE_STATE,
  resolveTimeLabelStep,
  SCHEDULE_FIT_CHROME,
  SCHEDULE_FIT_MODES,
  SCHEDULE_SCALE_DEFAULTS,
  shouldShowVerticalTimeLabel,
} from "./scheduleScale";

describe("scheduleScale", () => {
  it("uses defaults when not fullscreen", () => {
    expect(buildScheduleMetrics({ rowHRatio: 0.5 }, false)).toEqual({
      ...SCHEDULE_SCALE_DEFAULTS,
      fitMode: SCHEDULE_FIT_MODES.default,
    });
  });

  it("scales metrics in fullscreen", () => {
    const m = buildScheduleMetrics({ ...DEFAULT_SCALE_STATE, rowHRatio: 0.5, slotPxRatio: 0.75 }, true);
    expect(m.rowH).toBe(26);
    expect(m.slotPx).toBe(24);
  });

  it("computes fit scales for vertical orientation", () => {
    const ratios = computeFitScales({
      orientation: "vertical",
      viewportWidth: 1200,
      viewportHeight: 800,
      slotCount: 22,
      staffCount: 4,
    });
    expect(ratios.rowHRatio).toBeLessThan(1);
    expect(ratios.staffColRatio).toBeGreaterThan(0);
    const rowH = Math.round(SCHEDULE_SCALE_DEFAULTS.rowH * ratios.rowHRatio);
    const totalHeight = SCHEDULE_FIT_CHROME.verticalStickyHeader + 22 * rowH;
    expect(totalHeight).toBeLessThanOrEqual(810);
  });

  it("computes fit scales for horizontal orientation with group headers", () => {
    const ratios = computeFitScales({
      orientation: "horizontal",
      viewportWidth: 1400,
      viewportHeight: 700,
      slotCount: 24,
      staffCount: 5,
      staffGroupCount: 2,
    });
    expect(ratios.rowHRatio).toBeGreaterThan(0);
    expect(ratios.slotPxRatio).toBeGreaterThan(0);
  });

  it("thins vertical time labels when rows are compact", () => {
    expect(resolveTimeLabelStep(30, 40)).toBe(30);
    expect(resolveTimeLabelStep(30, 26)).toBe(30);
    expect(resolveTimeLabelStep(5, 20)).toBe(30);
    expect(shouldShowVerticalTimeLabel(600, 540, 30)).toBe(true);
    expect(shouldShowVerticalTimeLabel(545, 540, 30)).toBe(false);
  });

  it("reset clears fit mode", () => {
    expect(applyFitModeToState(SCHEDULE_FIT_MODES.default, {}, { rowHRatio: 0.4 })).toEqual(DEFAULT_SCALE_STATE);
  });
});
