import {
  daysFromClinicToday,
  filterPublicBookingSlots,
  getClinicNowParts,
  isPastEmptySlot,
  loadScheduleOrientation,
  resolveEmptySlotState,
  saveScheduleOrientation,
  SCHEDULE_ORIENTATION_KEY,
} from "./scheduleUtils";

describe("schedule past slots", () => {
  const tz = "Asia/Makassar";

  test("future date slots are not past", () => {
    expect(isPastEmptySlot({
      scheduleDate: "2099-01-01",
      slotMin: 540,
      timezone: tz,
      now: new Date("2026-06-02T10:00:00+08:00"),
    })).toBe(false);
  });

  test("past date slots are past", () => {
    expect(isPastEmptySlot({
      scheduleDate: "2020-01-01",
      slotMin: 540,
      timezone: tz,
      now: new Date("2026-06-02T10:00:00+08:00"),
    })).toBe(true);
  });

  test("today earlier slot is past in clinic timezone", () => {
    const now = new Date("2026-06-02T14:30:00+08:00");
    const { dateStr } = getClinicNowParts(tz, now);
    expect(isPastEmptySlot({
      scheduleDate: dateStr,
      slotMin: 9 * 60,
      timezone: tz,
      now,
    })).toBe(true);
    expect(isPastEmptySlot({
      scheduleDate: dateStr,
      slotMin: 15 * 60,
      timezone: tz,
      now,
    })).toBe(false);
  });

  test("resolveEmptySlotState blocks past empty slots", () => {
    const state = resolveEmptySlotState({
      scheduleDate: "2020-01-01",
      slotMin: 600,
      slotEnd: 630,
      timezone: tz,
      effective: { is_working: true, work_windows: [{ start: 540, end: 1200 }], block_ranges: [] },
      occupied: false,
      canManage: true,
      canCreateOvertime: false,
      staffName: "Dr. A",
      timeStr: "10:00",
    });
    expect(state.kind).toBe("past");
    expect(state.clickable).toBe(false);
  });
});

describe("schedule orientation persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("defaults to horizontal", () => {
    expect(loadScheduleOrientation()).toBe("horizontal");
  });

  test("persists vertical selection", () => {
    saveScheduleOrientation("vertical");
    expect(localStorage.getItem(SCHEDULE_ORIENTATION_KEY)).toBe("vertical");
    expect(loadScheduleOrientation()).toBe("vertical");
  });
});

describe("public booking date helpers", () => {
  const tz = "Asia/Makassar";

  test("daysFromClinicToday starts at clinic today", () => {
    const now = new Date("2026-06-02T14:30:00+08:00");
    const days = daysFromClinicToday(tz, 3, now);
    expect(days).toEqual(["2026-06-02", "2026-06-03", "2026-06-04"]);
  });

  test("filterPublicBookingSlots hides past times for today", () => {
    const now = new Date("2026-06-02T14:30:00+08:00");
    const slots = [
      { time: "2026-06-02T09:00:00", label: "09:00", available: true },
      { time: "2026-06-02T15:00:00", label: "15:00", available: true },
    ];
    const visible = filterPublicBookingSlots(slots, "2026-06-02", tz, now);
    expect(visible.map((s) => s.label)).toEqual(["15:00"]);
  });

  test("filterPublicBookingSlots returns empty for past dates", () => {
    const slots = [{ time: "2020-01-01T09:00:00", label: "09:00", available: true }];
    expect(filterPublicBookingSlots(slots, "2020-01-01", tz)).toEqual([]);
  });
});
