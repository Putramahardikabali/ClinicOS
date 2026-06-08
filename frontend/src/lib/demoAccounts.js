/**
 * Demo Clinic login credentials (existing production users only).
 *
 * Build: Create React App (craco) — only REACT_APP_* is inlined into the bundle.
 * Deploy: set VITE_DEMO_* build args; frontend/Dockerfile maps them to REACT_APP_DEMO_*.
 *
 * Demo password is embedded in the frontend bundle and should only be used for
 * public demo accounts with fake data.
 */

function readDemoEnv(viteKey, reactKey) {
  return (process.env[viteKey] || process.env[reactKey] || "").trim();
}

/** Returns null when neither env key is set (use code fallback); "" when explicitly cleared. */
function readDemoEnvOptional(viteKey, reactKey) {
  if (process.env[viteKey] !== undefined) return String(process.env[viteKey]).trim();
  if (process.env[reactKey] !== undefined) return String(process.env[reactKey]).trim();
  return null;
}

const DEMO_PASSWORD = readDemoEnv("VITE_DEMO_PASSWORD", "REACT_APP_DEMO_PASSWORD");

const envEmail = (roleEnvKey, fallback) => {
  const fromEnv = readDemoEnvOptional(
    `VITE_DEMO_${roleEnvKey}_EMAIL`,
    `REACT_APP_DEMO_${roleEnvKey}_EMAIL`,
  );
  if (fromEnv !== null) return fromEnv;
  return (fallback || "").trim();
};

export const demoAccounts = {
  owner: {
    email: envEmail("OWNER", "owner@democlinic.com"),
    password: DEMO_PASSWORD,
    label: "Owner",
    description: "Full clinic control, settings, billing, and staff management.",
  },
  manager: {
    email: envEmail("MANAGER", "manager@democlinic.com"),
    password: DEMO_PASSWORD,
    label: "Manager",
    description: "Day-to-day operations, staff, schedules, and clinic settings.",
  },
  fo: {
    email: envEmail("FO", "fo@democlinic.com"),
    password: DEMO_PASSWORD,
    label: "Front Office",
    description: "Appointments, check-in, patient intake, and front-desk queue.",
  },
  doctor: {
    email: envEmail("DOCTOR", "doctor1@democlinic.com"),
    password: DEMO_PASSWORD,
    label: "Doctor",
    description: "Clinical visits, EMR, assessments, and patient charts.",
  },
  therapist: {
    email: envEmail("THERAPIST", "therapist1@democlinic.com"),
    password: DEMO_PASSWORD,
    label: "Therapist",
    description: "Treatment sessions, therapist notes, and session documentation.",
  },
  accounting: {
    email: envEmail("ACCOUNTING", "acc@democlinic.com"),
    password: DEMO_PASSWORD,
    label: "Accounting",
    description: "Invoices, daily closing, POS, and finance reports.",
  },
};

export const DEMO_ROLE_ORDER = ["owner", "manager", "fo", "doctor", "therapist", "accounting"];

export const DEMO_BANNER_TEXT =
  "Demo mode: You are signing in with a sample Demo Clinic account.";

const BLOCKED_DEMO_EMAILS = new Set([
  "platform@clinicos.id",
  "admin@bodylab.id",
]);

export function isDemoRoleKey(key) {
  return Boolean(key && Object.prototype.hasOwnProperty.call(demoAccounts, key));
}

export function isDemoAccountConfigured(roleKey) {
  if (!isDemoRoleKey(roleKey)) return false;
  const account = demoAccounts[roleKey];
  if (!account?.email || !account?.password) return false;
  if (BLOCKED_DEMO_EMAILS.has(account.email.toLowerCase())) return false;
  return true;
}

export function getConfiguredDemoRoles() {
  return DEMO_ROLE_ORDER.filter(isDemoAccountConfigured);
}

export function getDemoAccount(roleKey) {
  if (!isDemoRoleKey(roleKey)) return null;
  return demoAccounts[roleKey];
}

/** Parse ?demo=role from login URL and return prefill payload when configured. */
export function resolveDemoLoginPrefill(search) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const roleKey = (params.get("demo") || "").trim().toLowerCase();
  if (!isDemoRoleKey(roleKey)) return null;
  const account = demoAccounts[roleKey];
  if (!isDemoAccountConfigured(roleKey)) {
    return { roleKey, configured: false, label: account?.label || roleKey };
  }
  return {
    roleKey,
    configured: true,
    email: account.email,
    password: account.password,
    label: account.label,
  };
}

export function demoLoginPath(roleKey) {
  return `/login?demo=${encodeURIComponent(roleKey)}`;
}
