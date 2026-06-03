/** Shared performer role helpers for bookings, billing, and commission UI. */

export const CLINICAL_PERFORMER_ROLES = ["doctor", "therapist", "nurse"];

export const ADDITIONAL_PERFORMER_TYPES = [
  { value: "assistant", label: "Assistant" },
  { value: "secondary", label: "Secondary" },
];

export const PERFORMER_TYPE_OPTIONS = [
  { value: "primary", label: "Primary" },
  { value: "assistant", label: "Assistant" },
  { value: "secondary", label: "Secondary" },
  { value: "nurse", label: "Nurse" },
  { value: "doctor", label: "Doctor" },
  { value: "therapist", label: "Therapist" },
  { value: "other", label: "Other" },
];

export function emptyAdditionalPerformerRow(defaultRole = "nurse") {
  return {
    staff_role: defaultRole,
    staff_id: "",
    performer_type: "assistant",
    notes: "",
  };
}

export function activeStaffForRole(staff, role) {
  return (staff || []).filter((s) => s.active !== false && s.role === role);
}

export function additionalRowsFromBooking(booking) {
  const performers = booking?.performers || [];
  return performers
    .filter((p) => (p.performer_type || "primary") !== "primary")
    .map((p) => ({
      staff_role: p.staff_role_snapshot || p.role || "nurse",
      staff_id: p.staff_id || "",
      performer_type: ["assistant", "secondary"].includes(p.performer_type)
        ? p.performer_type
        : "assistant",
      notes: p.notes || "",
    }));
}

export function validateAdditionalPerformers(rows, primaryPerformerId) {
  if (!rows?.length) return null;
  for (const row of rows) {
    if (!row.staff_id) {
      return "Select staff for each additional performer";
    }
  }
  const ids = [];
  if (primaryPerformerId) ids.push(primaryPerformerId);
  for (const row of rows) {
    if (row.staff_id) ids.push(row.staff_id);
  }
  if (new Set(ids).size !== ids.length) {
    return "Each performer must be a different staff member";
  }
  return null;
}

export function staffOptionsForRow({
  staff,
  role,
  primaryPerformerId,
  rows,
  rowIndex,
  availableIds,
  slotReady,
}) {
  const blocked = new Set([primaryPerformerId].filter(Boolean));
  rows.forEach((row, idx) => {
    if (idx !== rowIndex && row.staff_id) blocked.add(row.staff_id);
  });
  const availSet = new Set(availableIds || []);
  return activeStaffForRole(staff, role)
    .filter((s) => !blocked.has(s.id))
    .filter((s) => !slotReady || availSet.has(s.id));
}

export function pruneUnavailableAdditionalRows(rows, availByRole) {
  if (!rows?.length) return rows;
  let changed = false;
  const next = rows.map((row) => {
    if (!row.staff_id) return row;
    const role = row.staff_role || "nurse";
    const avail = new Set((availByRole?.[role] || []).map((p) => p.id || p));
    if (avail.has(row.staff_id)) return row;
    changed = true;
    return { ...row, staff_id: "" };
  });
  return changed ? next : rows;
}

export function validatePerformerAvailability(
  primaryId,
  assistants,
  availablePrimary,
  availByRole,
  { skipPrimary = false } = {},
) {
  if (
    !skipPrimary &&
    primaryId &&
    Array.isArray(availablePrimary) &&
    availablePrimary.length > 0
  ) {
    if (!availablePrimary.some((p) => p.id === primaryId)) {
      return "Selected primary performer is not available at this time";
    }
  }
  for (const row of assistants || []) {
    if (!row.staff_id) continue;
    const role = row.staff_role || "nurse";
    const avail = availByRole?.[role] || [];
    if (avail.length && !avail.some((p) => (p.id || p) === row.staff_id)) {
      return "An additional performer is not available at this time — pick another or remove the row";
    }
  }
  return null;
}

export function serviceAllowsMultiple(service) {
  return Boolean(service?.allow_multiple_performers);
}

export function filterEligibleStaff(staff, service) {
  if (!service) return [];
  const active = (staff || []).filter((s) => s.active !== false);
  const allowed = service.allowed_performer_roles;
  if (Array.isArray(allowed) && allowed.length) {
    return active.filter((s) => allowed.includes(s.role));
  }
  const pt = service.performer_type || "therapist";
  if (pt === "doctor") return active.filter((s) => s.role === "doctor");
  if (pt === "therapist") return active.filter((s) => s.role === "therapist");
  if (pt === "nurse") return active.filter((s) => s.role === "nurse");
  return active.filter((s) => CLINICAL_PERFORMER_ROLES.includes(s.role));
}

export function buildBookingPerformers(primaryId, assistants, staffList) {
  const out = [];
  if (primaryId) {
    const primary = (staffList || []).find((s) => s.id === primaryId);
    if (primary) {
      out.push({
        staff_id: primary.id,
        performer_type: "primary",
        notes: "",
        commission_eligible: true,
      });
    }
  }
  (assistants || []).forEach((row) => {
    const sid = row.staff_id || row.id;
    if (!sid || sid === primaryId) return;
    const person = (staffList || []).find((s) => s.id === sid);
    if (!person) return;
    const ptype = row.performer_type || "assistant";
    out.push({
      staff_id: person.id,
      performer_type: ["assistant", "secondary"].includes(ptype) ? ptype : "assistant",
      notes: row.notes || "",
      commission_eligible: true,
    });
  });
  return out;
}

export function formatPerformerBadge(p) {
  if (!p) return "—";
  const type = (p.performer_type || "primary").replace("_", " ");
  const name = p.staff_name_snapshot || p.performer_name_snapshot || p.name || "Staff";
  const role = p.staff_role_snapshot || p.performer_role_snapshot || p.role || "";
  return `${name}${role ? ` (${role})` : ""} · ${type}`;
}

export function itemPerformers(item) {
  if (Array.isArray(item?.performers) && item.performers.length) return item.performers;
  if (item?.performer_id) {
    return [{
      staff_id: item.performer_id,
      staff_name_snapshot: item.performer_name_snapshot || "",
      staff_role_snapshot: item.performer_role_snapshot || "",
      performer_type: "primary",
      commission_eligible: true,
    }];
  }
  return [];
}

export function serializeItemPerformers(item) {
  const performers = itemPerformers(item).map((p) => ({
    staff_id: p.staff_id,
    performer_type: p.performer_type || "primary",
    notes: p.notes || "",
    commission_eligible: p.commission_eligible !== false,
  }));
  const primary = performers.find((p) => p.performer_type === "primary") || performers[0];
  return {
    ...item,
    performers: performers.length ? performers : undefined,
    performer_id: primary?.staff_id || item.performer_id || undefined,
  };
}
