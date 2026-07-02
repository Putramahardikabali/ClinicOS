import {
  filterScheduleSessions,
  resolveDateRange,
  sessionTreatmentLabel,
  visitTypeLabel,
} from "./scheduleSessionsDrawer";

describe("scheduleSessionsDrawer", () => {
  it("defaults date range to schedule date", () => {
    expect(resolveDateRange("schedule", "2026-06-02")).toEqual({
      from: "2026-06-02",
      to: "2026-06-02",
    });
  });

  it("filters by patient search and type", () => {
    const rows = [
      {
        id: "1",
        patient_name: "Test Demo",
        patient_phone: "081234",
        visit_type: "doctor",
        visit_date: "2026-06-02T09:15:00Z",
        status: "in_progress",
      },
      {
        id: "2",
        patient_name: "Other",
        patient_phone: "099",
        visit_type: "therapist",
        visit_date: "2026-06-02T10:00:00Z",
      },
    ];
    const filtered = filterScheduleSessions(rows, {
      q: "0812",
      typeFilter: "doctor",
      fromDate: "2026-06-02",
      toDate: "2026-06-02",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("1");
  });

  it("formats visit type label", () => {
    expect(visitTypeLabel("doctor")).toBe("Doctor session");
  });

  it("reads treatment label from booking", () => {
    expect(sessionTreatmentLabel({ booking_treatment: "Anti-wrinkle" })).toBe("Anti-wrinkle");
  });
});
