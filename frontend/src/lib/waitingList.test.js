import { buildWaitlistBookingPrefill, resolveWaitlistDateRange } from "./waitingList";

describe("waitingList", () => {
  it("defaults date range to schedule date", () => {
    expect(resolveWaitlistDateRange("schedule", "2026-06-02")).toEqual({
      from: "2026-06-02",
      to: "2026-06-02",
    });
  });

  it("builds booking prefill from waitlist entry", () => {
    const prefill = buildWaitlistBookingPrefill({
      id: "wl-1",
      patient_id: "p1",
      patient_name: "Test Demo",
      patient_phone: "0812",
      treatment_name_snapshot: "Anti-wrinkle",
      desired_date: "2026-06-02",
      preferred_time_type: "specific",
      preferred_time: "09:15",
      preferred_staff_id: "s1",
      notes: "Please call first",
    }, "2026-06-02");
    expect(prefill.patient_id).toBe("p1");
    expect(prefill.treatment).toBe("Anti-wrinkle");
    expect(prefill.scheduled_time).toBe("09:15");
    expect(prefill.performer_id).toBe("s1");
    expect(prefill.waiting_list_id).toBe("wl-1");
    expect(prefill.notes).toBe("Please call first");
  });
});
