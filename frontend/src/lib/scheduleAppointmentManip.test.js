import {
  clampDuration,
  findLocalScheduleConflicts,
  formatScheduleTimeRange,
  snapMinutesToInterval,
} from "./scheduleAppointmentManip";

describe("scheduleAppointmentManip", () => {
  test("snapMinutesToInterval", () => {
    expect(snapMinutesToInterval(547, 15)).toBe(540);
    expect(snapMinutesToInterval(553, 15)).toBe(555);
  });

  test("clampDuration respects minimum", () => {
    expect(clampDuration(10, 15)).toBe(15);
    expect(clampDuration(45, 15)).toBe(45);
  });

  test("formatScheduleTimeRange", () => {
    expect(formatScheduleTimeRange("2026-06-02", 720, 90)).toBe("12:00 – 13:30");
  });

  test("findLocalScheduleConflicts", () => {
    const bookings = [
      {
        id: "a",
        performer_id: "s1",
        scheduled_at: "2026-06-02T10:00:00",
        duration_min: 60,
        status: "booked",
        patient_name: "Jane",
        treatment: "Facial",
      },
    ];
    const conflicts = findLocalScheduleConflicts(bookings, {
      staffId: "s1",
      startMin: 10 * 60 + 30,
      durationMin: 30,
      excludeBookingId: "b",
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].patient_name).toBe("Jane");
  });
});
