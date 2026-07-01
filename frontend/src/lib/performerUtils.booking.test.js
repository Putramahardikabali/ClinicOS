import {
  buildAssignedStaffOptions,
  resolvePerformerAfterAvailability,
  staffMemberById,
} from "@/lib/performerUtils";
import { evaluateNewBookingSubmit } from "@/lib/bookingSubmitValidation";

describe("resolvePerformerAfterAvailability", () => {
  const list = [{ id: "doc-2" }];

  it("keeps current performer even when not in available list", () => {
    expect(
      resolvePerformerAfterAvailability("doc-1", list, "doc-2", null, false),
    ).toBe("doc-1");
  });

  it("uses preferred performer when nothing selected", () => {
    expect(
      resolvePerformerAfterAvailability("", list, "doc-2", "doc-1", false),
    ).toBe("doc-1");
  });

  it("auto-suggests when empty", () => {
    expect(
      resolvePerformerAfterAvailability("", list, "doc-2", null, false),
    ).toBe("doc-2");
  });
});

describe("buildAssignedStaffOptions", () => {
  const eligible = [
    { id: "doc-1", name: "Doctor 1", role: "doctor" },
    { id: "doc-2", name: "Doctor 2", role: "doctor" },
  ];

  it("includes selected performer when off available list", () => {
    const options = buildAssignedStaffOptions({
      eligibleStaff: eligible,
      availablePerformers: [{ id: "doc-2" }],
      selectedPerformerId: "doc-1",
      slotChosen: true,
    });
    expect(options.map((s) => s.id)).toEqual(["doc-1", "doc-2"]);
  });
});

describe("evaluateNewBookingSubmit assigned staff", () => {
  const base = {
    busy: false,
    form: {
      patient_id: "p1",
      patient_name: "Jane",
      patient_phone: "08123456789",
      treatment: "Hydrafacial",
      package_id: "",
      scheduled_date: "2026-06-15",
      scheduled_time: "10:00",
      performer_id: "doc-1",
    },
    serviceSelected: true,
    isPackage: false,
    overtimeMeta: null,
    staff: [],
    eligibleStaff: [{ id: "doc-1", name: "Doctor 1", role: "doctor" }],
    availablePerformers: [{ id: "doc-2" }],
    loadingPerformers: false,
    appliedGiftCard: null,
    giftCardConstraint: { blocksSubmit: false },
  };

  it("allows submit when selected staff is not in available list", () => {
    const r = evaluateNewBookingSubmit(base);
    expect(r.canSubmit).toBe(true);
    expect(staffMemberById(base.staff, base.eligibleStaff, "doc-1")?.name).toBe("Doctor 1");
  });
});
