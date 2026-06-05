const STORAGE_KEY = "fd_appt_reminder_dismissed";
export const DISMISS_TTL_MS = 15 * 60 * 1000;

export function loadDismissedReminderKeys() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const active = {};
    for (const [key, expiresAt] of Object.entries(parsed)) {
      if (typeof expiresAt === "number" && expiresAt > now) {
        active[key] = expiresAt;
      }
    }
    if (Object.keys(active).length !== Object.keys(parsed).length) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    }
    return active;
  } catch {
    return {};
  }
}

export function isReminderDismissed(reminderKey, dismissedMap = null) {
  const map = dismissedMap || loadDismissedReminderKeys();
  return Boolean(map[reminderKey]);
}

export function dismissReminderKeys(keys) {
  const map = loadDismissedReminderKeys();
  const expiresAt = Date.now() + DISMISS_TTL_MS;
  for (const key of keys) {
    if (key) map[key] = expiresAt;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  return map;
}

export function filterActiveReminders(reminders, dismissedMap = null) {
  const map = dismissedMap || loadDismissedReminderKeys();
  return (reminders || []).filter((r) => r?.reminder_key && !map[r.reminder_key]);
}

export function groupReminders(reminders) {
  const confirm = reminders.filter((r) => r.kind === "unconfirmed_one_hour");
  const session = reminders.filter((r) => r.kind === "session_not_started");
  return { confirm, session, total: reminders.length };
}

export function formatReminderTime(scheduledAt) {
  if (!scheduledAt) return "—";
  try {
    return new Date(scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return scheduledAt.slice(11, 16) || "—";
  }
}
