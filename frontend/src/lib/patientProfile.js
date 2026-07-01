import { hasPermission } from "@/lib/auth";
import { resolvePatientNationality } from "@/lib/nationalities";

export const PATIENT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "appointments", label: "Appointments", key: "appointments" },
  { id: "visits", label: "Session records", key: "visits" },
  { id: "clinical_notes", label: "Clinical Notes", key: "clinical_notes" },
  { id: "photos", label: "Before/After Photos", key: "photos" },
  { id: "packages", label: "Packages", key: "packages" },
  { id: "prepaid", label: "Prepaid", key: "prepaid" },
  { id: "invoices", label: "Invoices", key: "invoices" },
  { id: "wallet", label: "Wallet", key: "wallet" },
  { id: "consents", label: "Consents", key: "consents" },
];

export const PATIENT_SOURCE_OPTIONS = [
  { value: "", label: "— Not specified —" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "google", label: "Google" },
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "walk_in", label: "Walk-in" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "hotel_villa", label: "Hotel / Villa" },
  { value: "other", label: "Other" },
];

export const SOURCE_DETAIL_PLACEHOLDER =
  "Add referral name, hotel name, influencer name, campaign, or other detail.";

export const BASIC_PATIENT_FIELDS = [
  "full_name",
  "phone",
  "email",
  "gender",
  "date_of_birth",
  "address",
  "nationality",
  "nationality_code",
  "patient_source",
  "source_detail",
  "allergies",
];

export function formatPatientSource(value) {
  if (!value) return "—";
  const opt = PATIENT_SOURCE_OPTIONS.find((o) => o.value === value);
  if (opt) return opt.label;
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const ACTIVITY_LABELS = {
  booking: "Appointment",
  visit: "Session record",
  package_purchase: "Package purchased",
  package_usage: "Package used",
  invoice: "Invoice",
  consent: "Consent",
  photo: "Photo",
  clinical_note: "Clinical note",
};

export const ACTIVITY_COLORS = {
  booking: "info",
  visit: "success",
  package_purchase: "warning",
  package_usage: "warning",
  invoice: "info",
  consent: "success",
  photo: "info",
  clinical_note: "success",
};

export function visibleTabs(access) {
  if (!access) return PATIENT_TABS.filter((t) => t.id === "overview");
  return PATIENT_TABS.filter((t) => !t.key || access[t.key]);
}

export function canEditBasicPatient(user) {
  return !!user && hasPermission(user, "patients.edit");
}

export function canEditFullPatientFields(user) {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  return user.role === "manager";
}

export function canViewClinicalPatientInfo(user) {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  return ["manager", "doctor", "therapist", "nurse"].includes(user.role);
}

export function canEditConsent(user) {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  if (hasPermission(user, "patients.edit")) return true;
  return user.role === "fo";
}

export function emptyBasicPatientForm(patient = {}) {
  const resolvedNationality = resolvePatientNationality(patient);
  return {
    full_name: patient.full_name || "",
    phone: patient.phone || "",
    email: patient.email || "",
    gender: patient.gender || "female",
    date_of_birth: patient.date_of_birth || patient.dob || "",
    address: patient.address || "",
    nationality: resolvedNationality?.name || patient.nationality || "",
    nationality_code: resolvedNationality?.code || patient.nationality_code || "",
    patient_source: patient.patient_source || "",
    source_detail: patient.source_detail || "",
    allergies: patient.allergies || "",
    medical_history: patient.medical_history || "",
    notes: patient.notes || "",
  };
}

export function basicPatientPayload(form) {
  return {
    full_name: form.full_name?.trim() || "",
    phone: form.phone || "",
    email: form.email || "",
    gender: form.gender || "",
    date_of_birth: form.date_of_birth || "",
    address: form.address || "",
    nationality: form.nationality || "",
    nationality_code: form.nationality_code || "",
    patient_source: form.patient_source || "",
    source_detail: form.source_detail || "",
    allergies: form.allergies || "",
  };
}

export function fullPatientPayload(form) {
  return {
    ...basicPatientPayload(form),
    medical_history: form.medical_history || "",
    notes: form.notes || "",
  };
}

export const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
export const fmtDate = (s) => (s ? new Date(s).toLocaleString() : "—");
export const fmtDay = (s) => (s ? new Date(s).toLocaleDateString() : "—");
