import { consentSummary } from "@/components/consent/ConsentStatusBadge";
import { recordNoteStatus } from "@/lib/clinicalNotes";
import { formatBillingLabel, visitNoteTabRoles, visitHasTreatmentContext } from "@/lib/visitUi";
import { hasFeature } from "@/lib/clinic";

export const WORKFLOW_STEPS = [
  { id: "overview", label: "Overview", shortLabel: "Overview" },
  { id: "consent", label: "Consent", shortLabel: "Consent", feature: "emr" },
  { id: "photos_before", label: "Before photos", shortLabel: "Before", feature: "photos" },
  { id: "clinical_notes", label: "Clinical notes", shortLabel: "Notes", feature: "emr" },
  { id: "mapping", label: "Mapping", shortLabel: "Map", feature: "mapping" },
  { id: "treatments", label: "Treatment & products", shortLabel: "Products", feature: "emr" },
  { id: "photos_after", label: "After photos", shortLabel: "After", feature: "photos" },
  { id: "final_review", label: "Final review", shortLabel: "Review", feature: "emr" },
];

/** Primary performer note role for this visit (doctor | therapist | nurse). */
export function primaryVisitNoteRole(visit) {
  const roles = visitNoteTabRoles(visit);
  if (roles.has("doctor")) return "doctor";
  if (roles.has("therapist")) return "therapist";
  if (roles.has("nurse")) return "nurse";
  return null;
}

/** Clinical-only overview alerts (no photos/mapping/workflow noise). */
export function buildVisitClinicalAlerts(visit, { invoice = null, showBilling = false } = {}) {
  const alerts = [];
  const allergies = (visit?.patient?.allergies || "").trim();
  const allergyDismissed = /^(none|no known|no|n\/a|na|-|—|tidak ada)$/i.test(allergies);
  if (allergies && !allergyDismissed) {
    alerts.push({ key: "allergy", label: "Patient allergies", detail: allergies });
  }

  if (showBilling) {
    const billing = formatBillingLabel(visit, invoice);
    if (billing.label === "Unpaid" && visit?.status !== "draft") {
      alerts.push({ key: "unpaid", label: "Payment outstanding", detail: billing.label });
    }
  }

  if (visit?.consent_required) {
    const info = consentSummary(visit?.consent_forms || []);
    if (info.status !== "signed") {
      alerts.push({
        key: "consent",
        label: "Consent required",
        detail: info.label || "Not signed yet",
      });
    }
  }

  const missing = [];
  if (!visit?.patient?.date_of_birth) missing.push("date of birth");
  if (!visit?.patient?.gender) missing.push("gender");
  if (!visit?.patient?.phone && !visit?.patient?.email) missing.push("contact phone or email");
  if (missing.length) {
    alerts.push({
      key: "medical_info",
      label: "Incomplete patient profile",
      detail: `Missing: ${missing.join(", ")}`,
    });
  }

  return alerts;
}

export function bookedTreatmentLabel(visit) {
  return (
    (visit?.booking?.treatment || "").trim()
    || (visit?.chief_complaint || "").trim()
    || (visit?.treatment_items?.[0]?.name || "").trim()
    || ""
  );
}

function consentStepStatus(visit) {
  const forms = visit?.consent_forms || [];
  const required = Boolean(visit?.consent_required);
  if (!required && !forms.length) return "done";
  const info = consentSummary(forms);
  if (!required) return "done";
  if (info.status === "signed") return "done";
  if (info.status === "pending" || info.status === "missing" || info.status === "not_sent") return "warning";
  if (!forms.length) return "warning";
  return "pending";
}

function noteStepStatus(record, visit) {
  const st = recordNoteStatus(record, visit);
  if (st === "locked" || st === "completed") return "done";
  if (record && (
    record.anamnesis || record.diagnosis || record.concern_notes || record.body_concern
    || record.therapist_notes || record.doctor_notes
  )) return "warning";
  return "pending";
}

export function computeStepStatus(stepId, visit, clinic, invoice, options = {}) {
  const { visitRoles } = options;
  const photos = visit?.photos || [];
  const beforeCount = photos.filter((p) => p.photo_type === "before").length;
  const afterCount = photos.filter((p) => p.photo_type === "after").length;

  switch (stepId) {
    case "overview":
      return "done";
    case "consent":
      return consentStepStatus(visit);
    case "photos_before":
      if (!clinic || !hasFeature(clinic, "photos")) return "pending";
      return beforeCount > 0 ? "done" : "pending";
    case "clinical_notes": {
      const roles = visitRoles || visitNoteTabRoles(visit);
      let any = false;
      let allDone = true;
      if (roles.has("doctor")) {
        any = true;
        const s = noteStepStatus(visit?.clinical_record, visit);
        if (s !== "done") allDone = false;
      }
      if (roles.has("therapist")) {
        any = true;
        const s = noteStepStatus(visit?.therapist_record, visit);
        if (s !== "done") allDone = false;
      }
      if (roles.has("nurse")) {
        any = true;
        const s = noteStepStatus(visit?.therapist_record, visit);
        if (s !== "done") allDone = false;
      }
      if (!any) return "pending";
      return allDone ? "done" : "warning";
    }
    case "mapping":
      if (!clinic || !hasFeature(clinic, "mapping")) return "pending";
      return (visit?.mappings || []).length > 0 ? "done" : "pending";
    case "treatments":
      return (visit?.treatment_items || []).length > 0 ? "done" : "pending";
    case "photos_after":
      if (!clinic || !hasFeature(clinic, "photos")) return "pending";
      return afterCount > 0 ? "done" : "pending";
    case "final_review": {
      const roles = visitRoles || visitNoteTabRoles(visit);
      if (roles.has("doctor")) {
        const st = recordNoteStatus(visit?.clinical_record, visit);
        if (st === "locked" || st === "completed") return "done";
        if (visit?.clinical_record?.signature) return "warning";
      }
      if (roles.has("therapist") || roles.has("nurse")) {
        const st = recordNoteStatus(visit?.therapist_record, visit);
        if (st === "locked" || st === "completed") return "done";
        if (visit?.therapist_record?.signature) return "warning";
      }
      return "pending";
    }
    default:
      return "pending";
  }
}

export function getVisibleWorkflowSteps(user, visit, clinic) {
  const visitRoles = visitNoteTabRoles(visit);
  const isClinicalStaff = ["doctor", "therapist", "nurse"].includes(user?.role);

  return WORKFLOW_STEPS.filter((step) => {
    if (step.feature && clinic && !hasFeature(clinic, step.feature)) return false;
    if (step.id === "clinical_notes") {
      if (!visitRoles.size) return false;
      if (isClinicalStaff) {
        return visitRoles.has(user.role) || user.role === "super_admin";
      }
      return user?.role === "super_admin" || user?.role === "manager" || user?.role === "fo";
    }
    if (step.id === "treatments" && isClinicalStaff && !["doctor", "therapist", "nurse", "super_admin"].includes(user?.role)) {
      return false;
    }
    return true;
  });
}

export function buildWorkflowStepStatuses(steps, visit, clinic, invoice) {
  const visitRoles = visitNoteTabRoles(visit);
  const map = {};
  for (const step of steps) {
    map[step.id] = computeStepStatus(step.id, visit, clinic, invoice, { visitRoles });
  }
  return map;
}

export function clinicalNotesStepLabel(visit) {
  const roles = visitNoteTabRoles(visit);
  if (roles.has("doctor") && !roles.has("therapist") && !roles.has("nurse")) return "Doctor notes";
  if (roles.has("therapist") && !roles.has("doctor") && !roles.has("nurse")) return "Therapist notes";
  if (roles.has("nurse") && !roles.has("doctor") && !roles.has("therapist")) return "Nurse notes";
  return "Clinical notes";
}

export function visitHasBookedTreatment(visit) {
  return Boolean(bookedTreatmentLabel(visit) || visitHasTreatmentContext(visit));
}

export function billingSummaryForReview(visit, invoice) {
  return formatBillingLabel(visit, invoice);
}
