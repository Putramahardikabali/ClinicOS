import api from "@/lib/api";
import { hasPermission } from "@/lib/auth";
import { buildDateParams, downloadReportExport, fetchReport } from "@/lib/reports";

export const ANALYTICS_TABS = [
  {
    id: "marketing",
    label: "Marketing",
    endpoint: "/reports/analytics/marketing",
    export: "/reports/analytics/marketing/export",
  },
  {
    id: "treatments",
    label: "Treatments",
    endpoint: "/reports/analytics/treatments",
    export: "/reports/analytics/treatments/export",
  },
  {
    id: "operational",
    label: "Operational",
    endpoint: "/reports/analytics/operational",
    export: "/reports/analytics/operational/export",
  },
];

export function canAccessAnalytics(user) {
  if (!user) return false;
  if (user.platform_admin) return true;
  if (!["super_admin", "manager"].includes(user.role)) return false;
  return hasPermission(user, "analytics.view");
}

export async function fetchAnalytics(endpoint, params = {}) {
  return fetchReport(endpoint, params);
}

export async function exportAnalytics(path, params, filename = "analytics.xlsx") {
  return downloadReportExport(path, params, filename);
}

export { buildDateParams };
