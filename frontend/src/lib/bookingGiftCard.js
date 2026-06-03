/**
 * Gift card apply/clear logic for New Booking (treatment & package entitlements).
 */

export function isGiftCardServiceLocked(applied) {
  const t = applied?.gift_card_type;
  return t === "treatment" || t === "package";
}

export function applyGiftCardToBookingForm(form, applied, treatments, packages) {
  if (!applied || !isGiftCardServiceLocked(applied)) return form;
  const next = { ...form };
  if (applied.gift_card_type === "treatment" && applied.treatment_name) {
    next.booking_kind = "treatment";
    next.treatment = applied.treatment_name;
    next.package_id = "";
    const t = treatments.find((x) => x.name === applied.treatment_name);
    if (t) {
      next.duration_min = t.duration_min || next.duration_min;
      next.treatment_category = t.category || next.treatment_category;
    }
  }
  if (applied.gift_card_type === "package" && applied.package_catalog_id) {
    next.booking_kind = "package";
    next.package_id = applied.package_catalog_id;
    const p = packages.find((x) => x.id === applied.package_catalog_id);
    next.treatment = p?.name || applied.package_name || next.treatment;
    if (p) {
      next.duration_min = p.duration_min || next.duration_min;
      next.package_type = p.package_type || next.package_type;
    }
  }
  return next;
}

export function clearGiftCardFromBookingForm(form) {
  return {
    ...form,
    booking_kind: "treatment",
    treatment: "",
    package_id: "",
    treatment_category: "",
    package_type: "",
    duration_min: 30,
  };
}

/** Map API lookup payload to applied gift card state (entitlements only). */
export function giftCardLookupToApplied(data) {
  if (!data?.valid || !data.card?.id) return null;
  const t = data.gift_card_type;
  if (t !== "treatment" && t !== "package") return null;
  return {
    gift_card_id: data.card.id,
    code: data.card.code,
    gift_card_type: t,
    treatment_name: data.treatment_name,
    package_name: data.package_name,
    package_catalog_id: data.package_catalog_id,
    treatment_catalog_id: data.treatment_catalog_id,
    face_value_idr: data.face_value_idr,
    card: data.card,
  };
}

export function normalizeGiftCardLookupError(error) {
  const e = (error || "").trim();
  if (!e) return "Gift card cannot be used.";
  if (/expired/i.test(e)) return "Gift card expired.";
  if (/already\s+(been\s+)?redeemed/i.test(e)) return "Gift card already redeemed.";
  if (/reserved/i.test(e)) return "Gift card is already reserved for another booking.";
  if (/select.*patient/i.test(e)) {
    return "Select or create a patient before redeeming this package gift card.";
  }
  if (/treatment.*no longer/i.test(e)) {
    return "This treatment gift card is linked to a treatment that no longer exists.";
  }
  if (/package.*no longer/i.test(e)) {
    return "This package gift card is linked to a package that no longer exists.";
  }
  if (/value\/credit/i.test(e)) return e;
  if (/not a (treatment|package) gift card/i.test(e)) return null;
  return e;
}

/** Lookup query params — omit booking_kind so package cards are not rejected while UI is on Treatment. */
export function bookingGiftCardLookupParams(code, patientId) {
  const params = { code: code.trim() };
  if (patientId) params.patient_id = patientId;
  return params;
}

export function evaluateGiftCardBookingConstraints({
  appliedGiftCard,
  form,
  serviceSelected,
  isPackage,
}) {
  if (!appliedGiftCard || !isGiftCardServiceLocked(appliedGiftCard)) {
    return { blocksSubmit: false, reason: null };
  }
  const card = appliedGiftCard.card || {};
  const status = (card.status || "").toLowerCase();
  if (status === "expired") {
    return { blocksSubmit: true, reason: "Gift card expired." };
  }
  if (status === "redeemed") {
    return { blocksSubmit: true, reason: "Gift card already redeemed." };
  }
  if (appliedGiftCard.gift_card_type === "package" && !form.patient_id) {
    return {
      blocksSubmit: true,
      reason: "Select or create a patient before redeeming this package gift card.",
    };
  }
  if (appliedGiftCard.gift_card_type === "treatment") {
    if (!serviceSelected) {
      return {
        blocksSubmit: true,
        reason: "This treatment gift card is linked to a treatment that no longer exists.",
      };
    }
    if (isPackage) {
      return { blocksSubmit: true, reason: "Treatment gift card requires a treatment booking." };
    }
  }
  if (appliedGiftCard.gift_card_type === "package") {
    if (!serviceSelected || !form.package_id) {
      return {
        blocksSubmit: true,
        reason: "Package gift card package could not be found.",
      };
    }
    if (!isPackage) {
      return { blocksSubmit: true, reason: "Package gift card requires a package booking." };
    }
    if (
      appliedGiftCard.package_catalog_id
      && form.package_id
      && form.package_id !== appliedGiftCard.package_catalog_id
    ) {
      return {
        blocksSubmit: true,
        reason: "Package gift card package could not be found.",
      };
    }
  }
  return { blocksSubmit: false, reason: null };
}

export const VALUE_CREDIT_BOOKING_MESSAGE =
  "This is a value/credit gift card. Please select a treatment or package first. The credit can be applied later at invoice/payment.";
