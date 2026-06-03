/** Shared helpers for clinical note status and editability. */

export const NOTE_STATUS_LABEL = {
  draft: "Draft",
  completed: "Completed",
  locked: "Locked",
};

export const NOTE_STATUS_CHIP = {
  draft: "",
  completed: "warning",
  locked: "success",
};

export function recordNoteStatus(record, visit) {
  if (visit?.status === "completed") return "locked";
  if (!record) return "draft";
  if (record.note_status === "locked") return "locked";
  if (record.submitted || record.note_status === "completed") return "completed";
  return record.note_status || "draft";
}

export function canEditClinicalNote(user, visit, record) {
  if (!user) return false;
  if (user.role === "fo") return false;
  if (user.role === "super_admin" || user.platform_admin) return true;
  const status = recordNoteStatus(record, visit);
  if (status === "draft") {
    return ["doctor", "therapist", "nurse"].includes(user.role);
  }
  return false;
}

export function requiresEditReason(user, visit, record) {
  if (!user) return false;
  if (user.role !== "super_admin" && !user.platform_admin) return false;
  const status = recordNoteStatus(record, visit);
  return status === "completed" || status === "locked";
}

export function templatesForRole(templates, role, visitType) {
  return (templates || []).filter((t) => {
    const roles = t.roles || [];
    const types = t.visit_types || [];
    const roleOk = !roles.length || roles.includes(role);
    const typeOk = !types.length || types.includes(visitType);
    return roleOk && typeOk;
  });
}

export function applyTemplateFields(current, templateFields) {
  if (!templateFields) return current;
  return { ...current, ...templateFields };
}
