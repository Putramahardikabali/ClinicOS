/**
 * New-booking submit gate: returns canSubmit, disabledReason, and debug snapshot.
 */

import { staffMemberById, isPerformerOffAvailable } from "@/lib/performerUtils";

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
  const selectedPerformer = staffMemberById(staff, eligibleStaff, primaryPerformerId);
  const isOvertime = !!overtimeMeta;
  const overtimeReason = overtimeMeta?.reason || "";
  const slotChosen = !!(selectedDate && selectedTime);
  const availLoaded = availablePerformers !== null && slotChosen && !loadingPerformers;
  const inAvailableList =
    !primaryPerformerId ||
    !availLoaded ||
    (availablePerformers || []).some((p) => p.id === primaryPerformerId);
  const inEligible = eligibleStaff.some((s) => s.id === primaryPerformerId);
  const offAvailable = isPerformerOffAvailable(availablePerformers, primaryPerformerId);
  const hasConflict = availLoaded && primaryPerformerId && offAvailable && inEligible && !isOvertime;

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
    offAvailable,
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
      disabledReason: "Patient phone is required for appointments.",
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
      disabledReason: "Select assigned staff.",
      debug,
    };
  }
  if (loadingPerformers) {
    return { canSubmit: false, disabledReason: "Checking staff availability…", debug };
  }

  return { canSubmit: true, disabledReason: null, debug };
}
