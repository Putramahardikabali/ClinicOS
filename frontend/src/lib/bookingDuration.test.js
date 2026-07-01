import {
  durationFromStartEnd,
  endTimeFromStartDuration,
  isCustomDuration,
  minutesToTime,
  parseTimeToMinutes,
} from "./bookingDuration";

describe("bookingDuration", () => {
  test("parseTimeToMinutes", () => {
    expect(parseTimeToMinutes("12:30")).toBe(750);
  });

  test("endTimeFromStartDuration", () => {
    expect(endTimeFromStartDuration("12:00", 90)).toBe("13:30");
  });

  test("durationFromStartEnd", () => {
    expect(durationFromStartEnd("12:00", "13:30", 30)).toBe(90);
  });

  test("isCustomDuration", () => {
    expect(isCustomDuration(90, 75)).toBe(true);
    expect(isCustomDuration(75, 75)).toBe(false);
  });

  test("minutesToTime wraps day", () => {
    expect(minutesToTime(24 * 60 + 30)).toBe("00:30");
  });
});
