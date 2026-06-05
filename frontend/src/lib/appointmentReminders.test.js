import {
  DISMISS_TTL_MS,
  dismissReminderKeys,
  filterActiveReminders,
  groupReminders,
  isReminderDismissed,
  loadDismissedReminderKeys,
} from "@/lib/appointmentReminders";

const STORAGE_KEY = "fd_appt_reminder_dismissed";

describe("appointmentReminders", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("filters dismissed reminders", () => {
    const reminders = [
      { reminder_key: "confirm:a", kind: "unconfirmed_one_hour" },
      { reminder_key: "session:b", kind: "session_not_started" },
    ];
    dismissReminderKeys(["confirm:a"]);
    const active = filterActiveReminders(reminders);
    expect(active).toHaveLength(1);
    expect(active[0].reminder_key).toBe("session:b");
  });

  it("expires dismissed keys after ttl", () => {
    dismissReminderKeys(["confirm:a"]);
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    expect(stored["confirm:a"]).toBe(1_000_000 + DISMISS_TTL_MS);

    jest.spyOn(Date, "now").mockReturnValue(1_000_000 + DISMISS_TTL_MS + 1);
    const map = loadDismissedReminderKeys();
    expect(map["confirm:a"]).toBeUndefined();
    expect(isReminderDismissed("confirm:a", map)).toBe(false);
  });

  it("groups reminders by kind", () => {
    const grouped = groupReminders([
      { kind: "unconfirmed_one_hour", reminder_key: "confirm:a" },
      { kind: "unconfirmed_one_hour", reminder_key: "confirm:b" },
      { kind: "session_not_started", reminder_key: "session:c" },
    ]);
    expect(grouped.total).toBe(3);
    expect(grouped.confirm).toHaveLength(2);
    expect(grouped.session).toHaveLength(1);
  });
});
