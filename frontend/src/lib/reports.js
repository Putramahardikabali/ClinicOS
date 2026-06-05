import api from "@/lib/api";
import { hasPermission, isAccountingUser } from "@/lib/auth";

export const DATE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom" },
];

export const REPORT_SECTIONS = [
  { id: "overview", label: "Overview", endpoint: "/reports/overview", export: "/reports/overview/export", fo: true },
  { id: "revenue", label: "Revenue", endpoint: "/reports/revenue", export: "/reports/revenue/export" },
  { id: "billing", label: "Billing", endpoint: "/reports/billing", export: "/reports/billing/export", fo: true },
  { id: "packages", label: "Packages", endpoint: "/reports/packages", export: "/reports/packages/export" },
  { id: "treatments", label: "Treatments", endpoint: "/reports/treatments", export: "/reports/treatments/export" },
  { id: "staff", label: "Staff", endpoint: "/reports/staff", export: "/reports/staff/export" },
  { id: "commission", label: "Commission", endpoint: "/reports/commission", export: "/reports/commission/export" },
  { id: "appointments", label: "Appointments & Session records", endpoint: "/reports/appointments", export: "/reports/appointments/export" },
  { id: "patients", label: "Patients", endpoint: "/reports/patients", export: "/reports/patients/export" },
  { id: "consent", label: "Consent & Clinical", endpoint: "/reports/consent", export: "/reports/consent/export" },
  { id: "inventory", label: "Inventory usage", endpoint: "/reports/inventory-usage" },
  { id: "audit", label: "Audit Log", endpoint: "/reports/audit-log", export: "/reports/audit-log/export" },
  { id: "gift-cards", label: "Gift Cards", endpoint: "/reports/gift-cards", export: "/reports/gift-cards/export" },
  { id: "wallet", label: "Patient Wallet", endpoint: "/wallet/report", export: "/wallet/report/export", exportCsv: true },
  { id: "online-booking-payments", label: "Online appointment payments", endpoint: "/reports/online-booking-payments", noDate: true },
];

const FO_SECTIONS = new Set(["overview", "billing"]);

const ACCOUNTING_SECTIONS = new Set([
  "overview",
  "revenue",
  "billing",
  "packages",
  "gift-cards",
  "wallet",
  "online-booking-payments",
]);

export function canAccessReports(user) {
  if (!user) return false;
  if (user.platform_admin || ["super_admin", "manager"].includes(user.role)) return true;
  if (hasPermission(user, "reports.view")) return true;
  if (hasPermission(user, "billing.view")) return true;
  return false;
}

export function canAccessReportSection(user, sectionId) {
  if (!user) return false;
  if (isAccountingUser(user)) return ACCOUNTING_SECTIONS.has(sectionId);
  if (user.platform_admin || ["super_admin", "manager"].includes(user.role)) return true;
  if (hasPermission(user, "reports.view")) return true;
  if (sectionId === "inventory" && hasPermission(user, "inventory.view")) return true;
  if (sectionId === "wallet" && (hasPermission(user, "wallet.view") || hasPermission(user, "accounting.view"))) return true;
  if (hasPermission(user, "billing.view") && FO_SECTIONS.has(sectionId)) return true;
  return false;
}

export function visibleReportSections(user) {
  return REPORT_SECTIONS.filter((s) => canAccessReportSection(user, s.id));
}

export function buildDateParams(preset, customFrom, customTo) {
  if (preset === "custom") {
    if (!customFrom || !customTo) return { preset: "this_month" };
    return { from: customFrom, to: customTo };
  }
  return { preset: preset || "this_month" };
}

export async function fetchReport(endpoint, params = {}) {
  const res = await api.get(endpoint, { params });
  return res.data;
}

export async function downloadReportExport(path, params, fallbackName = "report.xlsx") {
  const res = await api.get(path, { params, responseType: "blob" });
  const cd = res.headers["content-disposition"] || "";
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || fallbackName;
  const url = window.URL.createObjectURL(
    new Blob([res.data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
