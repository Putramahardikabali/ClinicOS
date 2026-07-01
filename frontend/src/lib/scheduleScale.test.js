import {
  applyFitModeToState,
  buildScheduleMetrics,
  computeFitScales,
  DEFAULT_SCALE_STATE,
  SCHEDULE_FIT_MODES,
  SCHEDULE_SCALE_DEFAULTS,
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
    expect(m.rowH).toBe(28);
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
  });

  it("reset clears fit mode", () => {
    expect(applyFitModeToState(SCHEDULE_FIT_MODES.default, {}, { rowHRatio: 0.4 })).toEqual(DEFAULT_SCALE_STATE);
  });
});
