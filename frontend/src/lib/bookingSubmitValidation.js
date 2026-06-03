/**
 * New-booking submit gate: returns canSubmit, disabledReason, and debug snapshot.
 */

function staffById(staff, id) {
  return (staff || []).find((s) => s.id === id) || null;
}

export function evaluateNewBookingSubmit({
  busy,
  form,
  serviceSelected,
  isPackage,
  overtimeMeta,
  staff,
  eligibleStaff,
  availablePerformers,
  loadingPerformers,
  appliedGiftCard,
  giftCardConstraint,
}) {
  const selectedPatient = form.patient_id
    ? { id: form.patient_id, name: form.patient_name, phone: form.patient_phone }
    : { id: null, name: form.patient_name, phone: form.patient_phone };
  const selectedService = isPackage
    ? { package_id: form.package_id, treatment: form.treatment }
    : { treatment: form.treatment };
  const selectedDate = form.scheduled_date || "";
  const selectedTime = form.scheduled_time || "";
  const primaryPerformerId = form.performer_id || "";
  const selectedPerformer = staffById(staff, primaryPerformerId);
  const isOvertime = !!overtimeMeta;
  const overtimeReason = overtimeMeta?.reason || "";
  const slotChosen = !!(selectedDate && selectedTime);
  const availLoaded = availablePerformers !== null && slotChosen && !loadingPerformers;
  const inAvailableList =
    !primaryPerformerId ||
    !availLoaded ||
    (availablePerformers || []).some((p) => p.id === primaryPerformerId);
  const inEligible = eligibleStaff.some((s) => s.id === primaryPerformerId);
  const hasConflict =
    availLoaded &&
    primaryPerformerId &&
    !inAvailableList &&
    inEligible &&
    !isOvertime;
  const outsideWorkingHours =
    isOvertime && primaryPerformerId && availLoaded && !inAvailableList && inEligible;

  const debug = {
    selectedPatient,
    selectedService,
    selectedDate,
    selectedTime,
    selectedPerformer: selectedPerformer
      ? { id: selectedPerformer.id, name: selectedPerformer.name, role: selectedPerformer.role }
      : null,
    primary_performer_id: primaryPerformerId,
    isOvertime,
    overtimeReason,
    outsideWorkingHours,
    hasConflict,
    inAvailableList,
    inEligible,
    loadingPerformers,
    availableCount: availablePerformers?.length ?? null,
  };

  if (busy) {
    return { canSubmit: false, disabledReason: "Saving…", debug };
  }
  if (giftCardConstraint?.blocksSubmit && giftCardConstraint.reason) {
    return { canSubmit: false, disabledReason: giftCardConstraint.reason, debug };
  }
  if (!form.patient_name?.trim()) {
    return { canSubmit: false, disabledReason: "Patient name is required.", debug };
  }
  const phone = (form.patient_phone || "").trim();
  if (!phone) {
    return {
      canSubmit: false,
      disabledReason: "Patient phone is required for bookings.",
      debug,
    };
  }
  if (!serviceSelected) {
    return { canSubmit: false, disabledReason: "Select a treatment or package.", debug };
  }
  if (!selectedDate) {
    return { canSubmit: false, disabledReason: "Select date and time.", debug };
  }
  if (!selectedTime) {
    return { canSubmit: false, disabledReason: "Select date and time.", debug };
  }
  if (isOvertime && !overtimeReason) {
    return { canSubmit: false, disabledReason: "Overtime reason is required.", debug };
  }
  if (!primaryPerformerId || !selectedPerformer) {
    return {
      canSubmit: false,
      disabledReason: "Select performer.",
      debug,
    };
  }
  if (loadingPerformers) {
    return { canSubmit: false, disabledReason: "Checking performer availability…", debug };
  }
  if (hasConflict) {
    return {
      canSubmit: false,
      disabledReason: "Selected performer already has a booking at this time.",
      debug,
    };
  }
  if (!isOvertime && availLoaded && (availablePerformers || []).length > 0 && !inAvailableList) {
    return {
      canSubmit: false,
      disabledReason: "Selected performer is not available at this time.",
      debug,
    };
  }
  if (!isOvertime && availLoaded && (availablePerformers || []).length === 0) {
    return {
      canSubmit: false,
      disabledReason: "No performer is available for this time. Try another slot.",
      debug,
    };
  }

  return { canSubmit: true, disabledReason: null, debug };
}
