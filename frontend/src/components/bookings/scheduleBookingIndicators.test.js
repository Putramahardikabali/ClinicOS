import {
  collectActiveIndicators,
  formatCardIndicatorLabels,
  resolveScheduleDisplayStatus,
  selectCardIcons,
  SCHEDULE_STATUS_COLORS,
} from "./scheduleBookingIndicators";

describe("scheduleBookingIndicators", () => {
  const baseBooking = {
    id: "b1",
    status: "booked",
    patient_name: "Jane",
    treatment: "Facial",
    scheduled_at: "2026-06-02T10:00:00",
    duration_min: 60,
  };

  it("maps block bookings to block_out colors", () => {
    const block = { status: "blocked", booking_type: "block" };
    expect(resolveScheduleDisplayStatus(block)).toBe("block_out");
    expect(SCHEDULE_STATUS_COLORS.block_out.label).toBe("Block out");
  });

  it("uses schedule_meta display_status when present", () => {
    const booking = {
      ...baseBooking,
      status: "checked_in",
      schedule_meta: { display_status: "treatment_started" },
    };
    expect(resolveScheduleDisplayStatus(booking)).toBe("treatment_started");
  });

  it("limits visible card icons to three by priority", () => {
    const booking = {
      ...baseBooking,
      schedule_meta: {
        profile_alert: { active: true, label: "Alert" },
        specific_staff_request: { active: true, label: "Dr A" },
        package_use: { active: true, label: "Pkg" },
        loyalty: { active: true, tier_name: "Gold" },
        new_patient: true,
        recurring_patient: false,
      },
    };
    const active = collectActiveIndicators(booking);
    expect(active).toEqual([
      "profile_alert",
      "specific_staff_request",
      "package_use",
      "loyalty",
      "new_patient",
    ]);
    const { visible, overflow } = selectCardIcons(booking);
    expect(visible).toHaveLength(3);
    expect(visible).toEqual(["profile_alert", "specific_staff_request", "package_use"]);
    expect(overflow).toBe(2);
  });

  it("shows recurring only when not new", () => {
    const booking = {
      ...baseBooking,
      schedule_meta: {
        new_patient: false,
        recurring_patient: true,
        profile_alert: { active: false },
        specific_staff_request: { active: false },
        package_use: { active: false },
        loyalty: { active: false },
      },
    };
    expect(collectActiveIndicators(booking)).toContain("recurring_patient");
  });

  it("formats all indicator labels for tooltip", () => {
    const booking = {
      ...baseBooking,
      schedule_meta: {
        profile_alert: { active: true },
        loyalty: { active: true },
        new_patient: true,
      },
    };
    expect(formatCardIndicatorLabels(booking)).toEqual(["Profile alert", "Loyalty", "New patient"]);
  });
});
