import {
  bookingDisplayStatus,
  bookingMatchesScheduleStatusFilter,
  filterBookingsByScheduleStatus,
  resolveApiStatusFilter,
} from "@/components/bookings/scheduleStatusFilter";
import { bookingMatchesScheduleSearch } from "@/components/bookings/scheduleSearch";

describe("scheduleStatusFilter", () => {
  it("maps display-only filters to no API status", () => {
    expect(resolveApiStatusFilter("treatment_started")).toBeNull();
    expect(resolveApiStatusFilter("block_out")).toBe("blocked");
    expect(resolveApiStatusFilter("confirmed")).toBe("confirmed");
  });

  it("filters treatment started by display status", () => {
    const bookings = [
      { id: "1", status: "checked_in", schedule_meta: { display_status: "treatment_started" } },
      { id: "2", status: "confirmed", schedule_meta: { display_status: "confirmed" } },
    ];
    const out = filterBookingsByScheduleStatus(bookings, "treatment_started");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("1");
  });

  it("matches block out time", () => {
    const block = { id: "b", status: "blocked", booking_type: "block" };
    expect(bookingMatchesScheduleStatusFilter(block, "block_out")).toBe(true);
    expect(bookingDisplayStatus(block)).toBe("block_out");
  });
});

describe("scheduleSearch", () => {
  it("matches patient name phone and treatment", () => {
    const b = { patient_name: "Jane Doe", patient_phone: "+628123", treatment: "Facial" };
    expect(bookingMatchesScheduleSearch(b, "jane")).toBe(true);
    expect(bookingMatchesScheduleSearch(b, "8123")).toBe(true);
    expect(bookingMatchesScheduleSearch(b, "facial")).toBe(true);
    expect(bookingMatchesScheduleSearch(b, "xyz")).toBe(false);
  });
});
