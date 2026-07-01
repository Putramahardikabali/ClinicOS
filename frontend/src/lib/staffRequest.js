/** Patient-requested provider helpers (explicit FO flag, not normal assignment). */

export function hasStaffRequest(booking) {
  return !!booking?.specific_staff_requested;
}

export function requestedStaffName(booking, staff = []) {
  const snapshot = (booking?.requested_staff_name_snapshot || "").trim();
  if (snapshot) return snapshot;
  const rid = booking?.requested_performer_id;
  const fromStaff = staff.find((s) => s.id === rid)?.name;
  if (fromStaff) return fromStaff;
  return booking?.schedule_meta?.specific_staff_request?.label || "this staff member";
}

export function staffRequestPayload(form, staff = []) {
  const checked = !!form.specific_staff_requested;
  if (!checked) {
    return {
      specific_staff_requested: false,
      requested_performer_id: null,
      requested_staff_name_snapshot: null,
    };
  }
  const id = form.performer_id || null;
  const person = staff.find((s) => s.id === id);
  return {
    specific_staff_requested: true,
    requested_performer_id: id,
    requested_staff_name_snapshot: person?.name || null,
  };
}

export function needsStaffRequestOverride(booking, newPerformerId) {
  if (!hasStaffRequest(booking)) return false;
  const requested = (booking.requested_performer_id || "").trim();
  if (!requested || !newPerformerId) return false;
  return newPerformerId !== requested;
}

export function parseStaffRequestConflict(error) {
  const detail = error?.response?.data?.detail;
  if (!detail || typeof detail !== "object") return null;
  if (detail.code !== "staff_request_conflict") return null;
  return detail;
}

export function staffRequestWarningMessage(conflict, booking, staff = []) {
  if (conflict?.message) return conflict.message;
  const name = conflict?.requested_staff_name || requestedStaffName(booking, staff);
  return `This patient requested ${name}. Are you sure you want to move this appointment to another staff?`;
}
