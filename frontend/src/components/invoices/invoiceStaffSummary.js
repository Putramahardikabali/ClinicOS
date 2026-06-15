import { itemPerformers } from "@/lib/performerUtils";

const ROLE_LABELS = { doctor: "Doctor", therapist: "Therapist", nurse: "Nurse" };

function formatNameRole(p) {
  const name = p.staff_name_snapshot || p.performer_name_snapshot || "—";
  const role = p.staff_role_snapshot || p.performer_role_snapshot || "";
  const roleLabel = ROLE_LABELS[role] || role;
  return roleLabel ? `${roleLabel}: ${name}` : name;
}

/** Compact staff lines for invoice item review (primary + additional summary). */
export function invoiceStaffSummary(item) {
  const performers = itemPerformers(item);
  if (!performers.length) {
    return { primaryLine: null, additionalLine: null, hasStaff: false };
  }
  const primary =
    performers.find((p) => (p.performer_type || "primary") === "primary") || performers[0];
  const additional = performers.filter((p) => p !== primary);
  const primaryLine = primary ? formatNameRole(primary) : null;
  const additionalNames = additional
    .map((p) => p.staff_name_snapshot || p.performer_name_snapshot)
    .filter(Boolean);
  return {
    primaryLine,
    additionalLine: additionalNames.length ? additionalNames.join(", ") : null,
    hasStaff: Boolean(primaryLine || additionalNames.length),
  };
}
