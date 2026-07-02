/** POS customer readiness helpers for walk-in vs registered patient modes. */

export function isPosCustomerReady({ walkIn, selectedPatient }) {
  if (walkIn) return true;
  return Boolean(selectedPatient?.id);
}

export function posCustomerValidationMessage({
  walkIn,
  selectedPatient,
  customerName,
  cartHasPackage,
  cartHasPrepaid,
}) {
  if (cartHasPackage && !selectedPatient?.id) {
    return "Select a patient — packages create a patient package after payment";
  }
  if (cartHasPrepaid && !selectedPatient?.id) {
    return "Select a patient — prepaid is issued to the patient after payment";
  }
  if (!walkIn && !selectedPatient?.id) {
    return "Select a patient.";
  }
  if (walkIn && !selectedPatient?.id && !String(customerName || "").trim()) {
    return "Enter walk-in customer name";
  }
  return null;
}
