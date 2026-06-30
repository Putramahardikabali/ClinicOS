import {
  clipDragRangeToValid,
  isDragRangeSelection,
  normalizeDragRange,
  slotCountInRange,
} from "./scheduleDragSelect";

describe("scheduleDragSelect", () => {
  test("normalizeDragRange orders anchor and target", () => {
    expect(normalizeDragRange(720, 660, 30)).toEqual({ startMin: 660, endMinExclusive: 750 });
    expect(normalizeDragRange(660, 720, 30)).toEqual({ startMin: 660, endMinExclusive: 750 });
  });

  test("isDragRangeSelection requires movement and multiple slots", () => {
    expect(isDragRangeSelection(true, 660, 720, 30)).toBe(true);
    expect(isDragRangeSelection(false, 660, 720, 30)).toBe(false);
    expect(isDragRangeSelection(true, 660, 690, 30)).toBe(false);
  });

  test("slotCountInRange", () => {
    expect(slotCountInRange(660, 720, 30)).toBe(2);
    expect(slotCountInRange(660, 690, 30)).toBe(1);
  });

  test("clipDragRangeToValid stops before invalid slot", () => {
    const valid = new Set([660, 690]);
    const clipped = clipDragRangeToValid({
      startMin: 660,
      endMinExclusive: 750,
      interval: 30,
      isSlotValid: (sm) => valid.has(sm),
    });
    expect(clipped).toEqual({ startMin: 660, endMinExclusive: 720 });
  });
});
