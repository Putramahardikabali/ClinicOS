import { hasPermission } from "@/lib/auth";
import { hasFeature } from "@/lib/clinic";

export function resolveScheduleUtilityAccess(user, clinic) {
  if (!user) {
    return {
      priceChecker: false,
      invoices: false,
      pos: false,
      sessions: false,
      dailyClosing: false,
      appointmentLog: false,
      legend: false,
    };
  }

  const role = user.role;
  const platform = user.platform_admin;

  const priceChecker =
    platform
    || role === "super_admin"
    || hasPermission(user, "treatments.manage")
    || hasPermission(user, "appointments.view")
    || hasPermission(user, "billing.view")
    || hasPermission(user, "visits.view")
    || hasPermission(user, "visits.view_own")
    || hasPermission(user, "packages_catalog.manage")
    || hasPermission(user, "packages.view");

  const invoices =
    (platform || role === "super_admin" || hasPermission(user, "billing.view") || hasPermission(user, "invoices.view"))
    && hasFeature(clinic, "billing");

  const pos =
    (platform || role === "super_admin" || hasPermission(user, "pos.view") || hasPermission(user, "pos.create"))
    && hasFeature(clinic, "products");

  const sessions =
    (platform
      || role === "super_admin"
      || hasPermission(user, "visits.view")
      || hasPermission(user, "visits.view_own"))
    && hasFeature(clinic, "emr");

  const dailyClosing =
    (platform || role === "super_admin" || hasPermission(user, "closing.view") || hasPermission(user, "closing.create"))
    && hasFeature(clinic, "products");

  const appointmentLog =
    platform
    || role === "super_admin"
    || role === "manager"
    || role === "fo"
    || hasPermission(user, "audit.view")
    || hasPermission(user, "appointments.view");

  const legend =
    platform
    || role === "super_admin"
    || hasPermission(user, "appointments.view")
    || hasPermission(user, "schedule.view_own");

  return {
    priceChecker,
    invoices,
    pos,
    sessions,
    dailyClosing,
    appointmentLog,
    legend,
  };
}

export const UTILITY_ITEMS = [
  { id: "price_checker", label: "Prices", permissionKey: "priceChecker" },
  { id: "invoices", label: "Invoices", permissionKey: "invoices" },
  { id: "pos", label: "POS", permissionKey: "pos" },
  { id: "sessions", label: "Sessions", permissionKey: "sessions" },
  { id: "daily_closing", label: "Closing", permissionKey: "dailyClosing" },
  { id: "appointment_log", label: "Log", permissionKey: "appointmentLog" },
  { id: "legend", label: "Legend", permissionKey: "legend" },
];
