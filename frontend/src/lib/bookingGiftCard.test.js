import {
  VALUE_CREDIT_BOOKING_MESSAGE,
  applyGiftCardToBookingForm,
  bookingGiftCardLookupParams,
  clearGiftCardFromBookingForm,
  evaluateGiftCardBookingConstraints,
  giftCardLookupToApplied,
  isGiftCardServiceLocked,
  normalizeGiftCardLookupError,
} from "@/lib/bookingGiftCard";

const treatments = [
  { id: "t1", name: "Hydrafacial", duration_min: 45, category: "Facial" },
];
const packages = [
  { id: "p1", name: "Premium Pack", duration_min: 60, package_type: "Wellness", price_idr: 6_000_000 },
];

describe("applyGiftCardToBookingForm", () => {
  const baseForm = {
    booking_kind: "package",
    treatment: "",
    package_id: "other",
    duration_min: 30,
  };

  it("treatment gift card switches tab to treatment and auto-selects treatment", () => {
    const applied = {
      gift_card_type: "treatment",
      treatment_name: "Hydrafacial",
    };
    const next = applyGiftCardToBookingForm(baseForm, applied, treatments, packages);
    expect(next.booking_kind).toBe("treatment");
    expect(next.treatment).toBe("Hydrafacial");
    expect(next.package_id).toBe("");
    expect(next.duration_min).toBe(45);
  });

  it("package gift card switches tab to package and auto-selects package", () => {
    const applied = {
      gift_card_type: "package",
      package_catalog_id: "p1",
      package_name: "Premium Pack",
    };
    const next = applyGiftCardToBookingForm(baseForm, applied, treatments, packages);
    expect(next.booking_kind).toBe("package");
    expect(next.package_id).toBe("p1");
    expect(next.treatment).toBe("Premium Pack");
  });

  it("value credit does not change form", () => {
    const applied = { gift_card_type: "value_credit" };
    const next = applyGiftCardToBookingForm(baseForm, applied, treatments, packages);
    expect(next).toEqual(baseForm);
  });

  it("clearing gift card unlocks service selection", () => {
    const locked = applyGiftCardToBookingForm(
      baseForm,
      { gift_card_type: "treatment", treatment_name: "Hydrafacial" },
      treatments,
      packages,
    );
    const cleared = clearGiftCardFromBookingForm(locked);
    expect(cleared.booking_kind).toBe("treatment");
    expect(cleared.treatment).toBe("");
    expect(cleared.package_id).toBe("");
  });
});

describe("giftCardLookupToApplied", () => {
  it("returns null for value credit lookup", () => {
    expect(
      giftCardLookupToApplied({
        valid: false,
        informational: true,
        gift_card_type: "value_credit",
        card: { id: "gc-1", code: "GC-TEST" },
      }),
    ).toBeNull();
  });

  it("returns applied payload for treatment", () => {
    const applied = giftCardLookupToApplied({
      valid: true,
      gift_card_type: "treatment",
      treatment_name: "Hydrafacial",
      card: { id: "gc-2", code: "GC-ABCD" },
    });
    expect(applied.gift_card_type).toBe("treatment");
    expect(applied.treatment_name).toBe("Hydrafacial");
  });

  it("returns applied payload for package", () => {
    const applied = giftCardLookupToApplied({
      valid: true,
      gift_card_type: "package",
      package_catalog_id: "p1",
      package_name: "Series Package Demo",
      card: { id: "gc-3", code: "GC-PKG" },
    });
    expect(applied.gift_card_type).toBe("package");
    expect(applied.package_catalog_id).toBe("p1");
  });
});

describe("bookingGiftCardLookupParams", () => {
  it("does not send booking_kind (avoids treatment-tab rejection for package cards)", () => {
    expect(bookingGiftCardLookupParams("GC-TEST", "pat-1")).toEqual({
      code: "GC-TEST",
      patient_id: "pat-1",
    });
    expect(bookingGiftCardLookupParams("GC-TEST", null)).toEqual({ code: "GC-TEST" });
    expect(bookingGiftCardLookupParams("GC-TEST", null).booking_kind).toBeUndefined();
  });
});

describe("package gift card from treatment tab", () => {
  it("switches to package and does not surface treatment mismatch error", () => {
    const lookup = {
      valid: true,
      gift_card_type: "package",
      package_catalog_id: "p1",
      package_name: "Series Package Demo",
      card: { id: "gc-pkg", code: "GC-PKG", status: "active" },
    };
    const applied = giftCardLookupToApplied(lookup);
    expect(applied).not.toBeNull();
    const form = applyGiftCardToBookingForm(
      { booking_kind: "treatment", treatment: "Old", package_id: "" },
      applied,
      treatments,
      packages,
    );
    expect(form.booking_kind).toBe("package");
    expect(form.package_id).toBe("p1");
    expect(normalizeGiftCardLookupError("This is a package gift card, not a treatment gift card")).toBeNull();
    const constraint = evaluateGiftCardBookingConstraints({
      appliedGiftCard: applied,
      form: { ...form, patient_id: "pat-1" },
      serviceSelected: true,
      isPackage: true,
    });
    expect(constraint.blocksSubmit).toBe(false);
  });
});

describe("isGiftCardServiceLocked", () => {
  it("locks treatment and package only", () => {
    expect(isGiftCardServiceLocked({ gift_card_type: "treatment" })).toBe(true);
    expect(isGiftCardServiceLocked({ gift_card_type: "package" })).toBe(true);
    expect(isGiftCardServiceLocked({ gift_card_type: "value_credit" })).toBe(false);
    expect(isGiftCardServiceLocked(null)).toBe(false);
  });
});

describe("evaluateGiftCardBookingConstraints", () => {
  it("requires patient for package gift card", () => {
    const r = evaluateGiftCardBookingConstraints({
      appliedGiftCard: { gift_card_type: "package", card: { status: "active" } },
      form: { patient_id: "" },
      serviceSelected: true,
      isPackage: true,
    });
    expect(r.blocksSubmit).toBe(true);
    expect(r.reason).toMatch(/patient/i);
  });

  it("does not run treatment-missing check for package gift card", () => {
    const r = evaluateGiftCardBookingConstraints({
      appliedGiftCard: {
        gift_card_type: "package",
        package_catalog_id: "p1",
        card: { status: "active" },
      },
      form: { patient_id: "pat-1", package_id: "p1" },
      serviceSelected: true,
      isPackage: true,
    });
    expect(r.blocksSubmit).toBe(false);
  });

  it("reports package not found when package_id missing", () => {
    const r = evaluateGiftCardBookingConstraints({
      appliedGiftCard: { gift_card_type: "package", package_catalog_id: "p1", card: { status: "active" } },
      form: { patient_id: "pat-1", package_id: "" },
      serviceSelected: false,
      isPackage: true,
    });
    expect(r.reason).toBe("Package gift card package could not be found.");
  });

  it("maps expired status", () => {
    const r = evaluateGiftCardBookingConstraints({
      appliedGiftCard: { gift_card_type: "treatment", card: { status: "expired" } },
      form: { patient_id: "p1" },
      serviceSelected: true,
      isPackage: false,
    });
    expect(r.reason).toBe("Gift card expired.");
  });
});

describe("normalizeGiftCardLookupError", () => {
  it("normalizes expired and redeemed messages", () => {
    expect(normalizeGiftCardLookupError("Gift card has expired")).toBe("Gift card expired.");
    expect(normalizeGiftCardLookupError("Gift card has already been redeemed")).toBe(
      "Gift card already redeemed.",
    );
  });
});

describe("VALUE_CREDIT_BOOKING_MESSAGE", () => {
  it("mentions invoice/payment", () => {
    expect(VALUE_CREDIT_BOOKING_MESSAGE).toMatch(/invoice\/payment/i);
  });
});
