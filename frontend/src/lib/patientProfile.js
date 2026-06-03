import { hasPermission } from "@/lib/auth";

export const PATIENT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "appointments", label: "Appointments", key: "appointments" },
  { id: "visits", label: "Visits", key: "visits" },
  { id: "clinical_notes", label: "Clinical Notes", key: "clinical_notes" },
  { id: "photos", label: "Before/After Photos", key: "photos" },
  { id: "packages", label: "Packages", key: "packages" },
  { id: "invoices", label: "Invoices", key: "invoices" },
  { id: "wallet", label: "Wallet", key: "wallet" },
  { id: "consents", label: "Consents", key: "consents" },
  { id: "timeline", label: "Timeline", key: "timeline" },
];

export const ACTIVITY_LABELS = {
  booking: "Appointment",
  visit: "Visit",
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

export function canEditConsent(user) {
  if (!user) return false;
  if (user.platform_admin || user.role === "super_admin") return true;
  if (hasPermission(user, "patients.edit")) return true;
  return user.role === "fo";
}

export const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
export const fmtDate = (s) => (s ? new Date(s).toLocaleString() : "—");
export const fmtDay = (s) => (s ? new Date(s).toLocaleDateString() : "—");
