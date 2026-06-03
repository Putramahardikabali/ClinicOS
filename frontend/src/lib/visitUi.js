import { recordNoteStatus } from "@/lib/clinicalNotes";
import { CLINICAL_PERFORMER_ROLES } from "@/lib/performerUtils";

function consentChecklistStatus(forms = [], consentRequired = true) {
  if (!consentRequired) return "not_required";
  const active = forms.filter((f) => f.status !== "cancelled");
  if (!active.length) return "missing";
  if (active.every((f) => f.status === "signed")) return "done";
  const hasLinkPending = active.some((f) => {
    const ls = f.public_link?.status;
    return ls === "pending" || ls === "opened";
  });
  const hasFormPending = active.some((f) => ["pending", "not_sent", "draft"].includes(f.status));
  if (hasLinkPending || hasFormPending) return "pending";
  if (active.some((f) => f.status === "expired")) return "missing";
  return "missing";
}

export function visitHasTreatmentContext(visit) {
  return Boolean(
    visit?.booking_id
    || (visit?.chief_complaint || "").trim()
    || (visit?.treatment_items || []).length > 0
    || (visit?.booking?.treatment || "").trim(),
  );
}

export const CHECKLIST_STATUS = {
  done: { label: "Done", chip: "success" },
  pending: { label: "Pending", chip: "warning" },
  missing: { label: "Missing", chip: "warning" },
  not_required: { label: "Not required", chip: "" },
};

export function visitPerformerRoles(visit) {
  const roles = new Set();
  for (const p of visit?.performers || []) {
    const r = (p.staff_role_snapshot || "").toLowerCase();
    if (CLINICAL_PERFORMER_ROLES.includes(r)) roles.add(r);
  }
  if (roles.size > 0) return roles;
  const assigned = (visit?.assigned_user?.role || "").toLowerCase();
  if (CLINICAL_PERFORMER_ROLES.includes(assigned)) roles.add(assigned);
  const vt = (visit?.visit_type || "").toLowerCase();
  if (CLINICAL_PERFORMER_ROLES.includes(vt)) roles.add(vt);
  return roles;
}

/** Primary performer roles that get their own note tab / print section (assistants excluded). */
export function visitNoteTabRoles(visit) {
  const roles = new Set();
  const performers = visit?.performers || [];
  if (performers.length) {
    for (const p of performers) {
      const r = (p.staff_role_snapshot || "").toLowerCase();
      if (!CLINICAL_PERFORMER_ROLES.includes(r)) continue;
      const ptype = (p.performer_type || "primary").toLowerCase();
      if (ptype === "primary") roles.add(r);
    }
    if (roles.size > 0) return roles;
  }
  const assigned = (visit?.assigned_user?.role || "").toLowerCase();
  if (CLINICAL_PERFORMER_ROLES.includes(assigned)) roles.add(assigned);
  const vt = (visit?.visit_type || "").toLowerCase();
  if (CLINICAL_PERFORMER_ROLES.includes(vt)) roles.add(vt);
  return roles;
}

export function visitClinicalPerformers(visit) {
  const performers = visit?.performers || [];
  if (performers.length) {
    return performers.filter((p) =>
      CLINICAL_PERFORMER_ROLES.includes((p.staff_role_snapshot || "").toLowerCase()),
    );
  }
  if (visit?.assigned_user?.id) {
    return [{
      staff_id: visit.assigned_user.id,
      staff_name_snapshot: visit.assigned_user.name,
      staff_role_snapshot: visit.assigned_user.role,
      performer_type: "primary",
    }];
  }
  return [];
}

export function normalizeTreatmentAllowedRoles(treatment) {
  if (!treatment) return [];
  const allowed = treatment.allowed_performer_roles;
  if (Array.isArray(allowed) && allowed.length) {
    return allowed.filter((r) => CLINICAL_PERFORMER_ROLES.includes(r));
  }
  const pt = (treatment.performer_type || "therapist").toLowerCase();
  if (pt === "either") return [...CLINICAL_PERFORMER_ROLES];
  if (CLINICAL_PERFORMER_ROLES.includes(pt)) return [pt];
  return ["therapist"];
}

export function treatmentAllowedForVisitRoles(treatment, visitRoles) {
  if (!treatment || !visitRoles?.size) return false;
  const allowed = normalizeTreatmentAllowedRoles(treatment);
  return allowed.some((r) => visitRoles.has(r));
}

export function formatBillingLabel(visit, invoice = null) {
  const items = invoice?.items || [];
  const allPackage =
    items.length > 0 && items.every((it) => it.paid_by === "package") && Number(invoice?.total_amount || 0) === 0;
  if (allPackage) return { label: "Paid by package", chip: "success" };
  const invStatus = invoice?.payment_status;
  if (invStatus === "partial") return { label: "Partial", chip: "info" };
  if (invStatus === "paid" || visit?.payment_status === "paid") return { label: "Paid", chip: "success" };
  if (visit?.payment_status === "partial") return { label: "Partial", chip: "info" };
  return { label: "Unpaid", chip: "warning" };
}

function noteChecklistStatus(record, visit) {
  const status = recordNoteStatus(record, visit);
  if (status === "locked" || status === "completed") return "done";
  if (record && (record.anamnesis || record.diagnosis || record.concern_notes || record.body_concern || record.therapist_notes || record.doctor_notes)) {
    return "pending";
  }
  return "missing";
}

export function buildVisitChecklist(visit, options = {}) {
  const { invoice = null, hasMappingFeature = true, hasPhotosFeature = true } = options;
  const visitRoles = visitNoteTabRoles(visit);
  const forms = visit?.consent_forms || [];
  const consentRequired = Boolean(visit?.consent_required);
  const consentStatus = consentChecklistStatus(forms, consentRequired);

  const rows = [
    { key: "patient", label: "Patient details", status: visit?.patient?.full_name ? "done" : "missing" },
    { key: "consent", label: "Consent prepared / signed", status: consentStatus },
  ];

  if (visitRoles.has("doctor")) {
    rows.push({
      key: "doctor_notes",
      label: "Doctor notes",
      status: noteChecklistStatus(visit?.clinical_record, visit),
    });
  }
  if (visitRoles.has("therapist")) {
    rows.push({
      key: "therapist_notes",
      label: "Therapist notes",
      status: noteChecklistStatus(visit?.therapist_record, visit),
    });
  }
  if (visitRoles.has("nurse")) {
    rows.push({
      key: "nurse_notes",
      label: "Nurse notes",
      status: noteChecklistStatus(visit?.therapist_record, visit),
    });
  }

  rows.push(
    {
      key: "treatments",
      label: "Treatment items",
      status: (visit?.treatment_items || []).length > 0 ? "done" : "pending",
    },
    {
      key: "photos",
      label: "Photos",
      status: !hasPhotosFeature
        ? "not_required"
        : (visit?.photos || []).length > 0
          ? "done"
          : "pending",
    },
    {
      key: "mapping",
      label: "Mapping",
      status: !hasMappingFeature
        ? "not_required"
        : (visit?.mappings || []).length > 0
          ? "done"
          : "pending",
    },
    {
      key: "billing",
      label: "Invoice / payment",
      status: (() => {
        const b = formatBillingLabel(visit, invoice);
        if (b.label === "Paid" || b.label === "Paid by package") return "done";
        if (b.label === "Partial") return "pending";
        return visit?.status === "completed" ? "pending" : "pending";
      })(),
      detail: formatBillingLabel(visit, invoice).label,
    },
  );
  return rows;
}

export function primaryAndAdditionalPerformers(visit) {
  const performers = visit?.performers || [];
  const primary =
    performers.find((p) => p.performer_type === "primary")
    || (visit?.assigned_user
      ? {
          staff_name_snapshot: visit.assigned_user.name,
          staff_role_snapshot: visit.assigned_user.role,
          performer_type: "primary",
        }
      : null);
  const additional = performers.filter((p) => p.performer_type && p.performer_type !== "primary");
  return { primary, additional };
}
