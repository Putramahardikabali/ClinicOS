import { evaluateNewBookingSubmit } from "@/lib/bookingSubmitValidation";

describe("evaluateNewBookingSubmit phone", () => {
  const base = {
    busy: false,
    form: {
      patient_id: "p1",
      patient_name: "Jane",
      patient_phone: "",
      booking_kind: "treatment",
      treatment: "Hydrafacial",
      package_id: "",
      scheduled_date: "2026-06-15",
      scheduled_time: "10:00",
      performer_id: "staff-1",
    },
    serviceSelected: true,
    isPackage: false,
    overtimeMeta: null,
    staff: [{ id: "staff-1", name: "Dr A", role: "doctor" }],
    eligibleStaff: [{ id: "staff-1", name: "Dr A", role: "doctor" }],
    availablePerformers: [{ id: "staff-1" }],
    loadingPerformers: false,
    appliedGiftCard: null,
    giftCardConstraint: { blocksSubmit: false },
  };

  it("blocks when phone missing", () => {
    const r = evaluateNewBookingSubmit(base);
    expect(r.canSubmit).toBe(false);
    expect(r.disabledReason).toBe("Patient phone is required for bookings.");
  });

  it("allows submit when inline phone is entered", () => {
    const r = evaluateNewBookingSubmit({
      ...base,
      form: { ...base.form, patient_phone: "08123456789" },
    });
    expect(r.canSubmit).toBe(true);
  });
});
