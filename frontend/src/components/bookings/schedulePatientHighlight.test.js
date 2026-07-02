import { describe, it, expect } from "@jest/globals";
import {
  bookingMatchesPatientHighlight,
  countVisiblePatientBookings,
  isHighlightableBooking,
  patientHighlightBannerText,
} from "./schedulePatientHighlight";

describe("schedulePatientHighlight", () => {
  it("detects highlightable bookings", () => {
    expect(isHighlightableBooking({ patient_id: "p1", booking_type: "treatment" })).toBe(true);
    expect(isHighlightableBooking({ booking_type: "block", status: "blocked" })).toBe(false);
  });

  it("matches patient on same day", () => {
    const b = { patient_id: "p1", scheduled_at: "2026-06-02T10:00:00", booking_type: "treatment" };
    expect(bookingMatchesPatientHighlight(b, { patientId: "p1" }, "2026-06-02")).toBe(true);
    expect(bookingMatchesPatientHighlight(b, { patientId: "p2" }, "2026-06-02")).toBe(false);
    expect(bookingMatchesPatientHighlight(b, { patientId: "p1" }, "2026-06-03")).toBe(false);
  });

  it("counts visible bookings", () => {
    const bookings = [
      { id: "1", patient_id: "p1", scheduled_at: "2026-06-02T09:00:00" },
      { id: "2", patient_id: "p1", scheduled_at: "2026-06-02T11:00:00" },
      { id: "3", patient_id: "p2", scheduled_at: "2026-06-02T12:00:00" },
    ];
    expect(countVisiblePatientBookings(bookings, "p1", "2026-06-02")).toBe(2);
  });

  it("formats banner text", () => {
    expect(patientHighlightBannerText({ patientName: "Veronica Ng", visibleCount: 1 })).toBe("Highlighting: Veronica Ng");
    expect(patientHighlightBannerText({ patientName: "Veronica Ng", visibleCount: 3 })).toBe(
      "Highlighting: Veronica Ng · 3 bookings",
    );
  });
});
