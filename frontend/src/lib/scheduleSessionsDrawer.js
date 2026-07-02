import { formatBillingLabel, visitNoteTabRoles } from "@/lib/visitUi";
import { primaryVisitNoteRole } from "@/lib/visitWorkflow";

export const SESSION_STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "submitted", label: "Submitted" },
  { key: "completed", label: "Completed" },
];

export const SESSION_TYPE_FILTERS = [
  { key: "", label: "All types" },
  { key: "doctor", label: "Doctor" },
  { key: "therapist", label: "Therapist" },
  { key: "nurse", label: "Nurse" },
];

export const DATE_PRESETS = [
  { key: "schedule", label: "Schedule date" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
];

function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolveDateRange(preset, scheduleDate) {
  const now = new Date();
  const schedule = scheduleDate ? new Date(`${scheduleDate}T12:00:00`) : now;

  switch (preset) {
    case "today":
      return { from: toYmd(now), to: toYmd(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: toYmd(y), to: toYmd(y) };
    }
    case "last7": {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: toYmd(from), to: toYmd(now) };
    }
    case "last30": {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: toYmd(from), to: toYmd(now) };
    }
    case "schedule":
    default:
      return { from: scheduleDate || toYmd(schedule), to: scheduleDate || toYmd(schedule) };
  }
}

function sessionInstant(visit) {
  const raw = visit?.scheduled_at || visit?.visit_date || visit?.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function sessionTreatmentLabel(visit) {
  return (
    (visit?.booking_treatment || "").trim()
    || (visit?.chief_complaint || "").trim()
    || ""
  );
}

export function visitTypeLabel(visitType) {
  const t = (visitType || "").toLowerCase();
  if (t === "doctor") return "Doctor session";
  if (t === "therapist") return "Therapist session";
  if (t === "nurse") return "Nurse session";
  return "Session";
}

export function formatSessionTime(visit) {
  const d = sessionInstant(visit);
  if (!d) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatSessionDate(visit) {
  const d = sessionInstant(visit);
  if (!d) return "—";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function sessionStatusChip(status) {
  if (status === "completed") return "success";
  if (status === "submitted") return "warning";
  return "info";
}

export function sessionPaymentLabel(visit) {
  const invoice = visit?.invoice_id
    ? { payment_status: visit.invoice_payment_status }
    : null;
  return formatBillingLabel(visit, invoice);
}

export function filterScheduleSessions(rows, {
  q = "",
  typeFilter = "",
  fromDate = "",
  toDate = "",
  patientId = "",
} = {}) {
  const needle = q.trim().toLowerCase();
  return (rows || []).filter((v) => {
    if (patientId && v.patient_id !== patientId) return false;
    if (typeFilter && v.visit_type !== typeFilter) return false;
    const d = sessionInstant(v);
    if (fromDate && d) {
      const from = new Date(`${fromDate}T00:00:00`);
      if (d < from) return false;
    }
    if (toDate && d) {
      const to = new Date(`${toDate}T23:59:59`);
      if (d > to) return false;
    }
    if (!needle) return true;
    const name = (v.patient_name || "").toLowerCase();
    const phone = (v.patient_phone || "").toLowerCase();
    return name.includes(needle) || phone.includes(needle);
  });
}

export function canViewClinicalNotesSummary(user, visit) {
  if (!user || !visit) return false;
  const primaryRole = primaryVisitNoteRole(visit);
  if (!primaryRole) return false;
  if (["super_admin", "fo", "manager"].includes(user.role) || user.platform_admin) return true;
  return user.role === primaryRole;
}

export function clinicalNotesSummaryText(visit, user) {
  if (!canViewClinicalNotesSummary(user, visit)) return null;
  const roles = visitNoteTabRoles(visit);
  const parts = [];
  if (roles.has("doctor") && visit.clinical_record) {
    const r = visit.clinical_record;
    parts.push(r.anamnesis, r.diagnosis, r.doctor_notes, r.therapy_notes);
  }
  if ((roles.has("therapist") || roles.has("nurse")) && visit.therapist_record) {
    const r = visit.therapist_record;
    parts.push(r.concern_notes, r.therapist_notes, r.body_concern);
  }
  for (const n of visit.performer_notes || []) {
    parts.push(n.content);
  }
  const text = parts.filter(Boolean).join(" ").trim();
  if (!text) return null;
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

export function canOpenSessionWorkflow(user, visit) {
  if (!user || !visit) return false;
  if (visit.status === "completed") return false;
  if (["doctor", "therapist", "nurse", "super_admin"].includes(user.role)) return true;
  return false;
}
