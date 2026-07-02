import { resolveScheduleUtilityAccess, UTILITY_ITEMS } from "./scheduleUtilityPermissions";

describe("scheduleUtilityPermissions", () => {
  const clinicWithBilling = {
    features: ["billing", "products", "treatments", "emr"],
  };

  it("grants legend to appointment viewers", () => {
    const access = resolveScheduleUtilityAccess(
      { role: "fo", permissions: ["appointments.view"] },
      clinicWithBilling,
    );
    expect(access.legend).toBe(true);
    expect(access.priceChecker).toBe(true);
  });

  it("hides invoices without billing permission", () => {
    const access = resolveScheduleUtilityAccess(
      { role: "therapist", permissions: ["visits.view_own"] },
      clinicWithBilling,
    );
    expect(access.invoices).toBe(false);
    expect(access.legend).toBe(false);
  });

  it("shows invoices for billing viewers", () => {
    const access = resolveScheduleUtilityAccess(
      { role: "fo", permissions: ["billing.view", "appointments.view", "closing.view"] },
      clinicWithBilling,
    );
    expect(access.invoices).toBe(true);
    expect(access.dailyClosing).toBe(true);
  });

  it("shows sessions for visit viewers with emr feature", () => {
    const access = resolveScheduleUtilityAccess(
      { role: "fo", permissions: ["visits.view", "appointments.view"] },
      clinicWithBilling,
    );
    expect(access.sessions).toBe(true);
  });

  it("hides sessions without emr feature", () => {
    const access = resolveScheduleUtilityAccess(
      { role: "fo", permissions: ["visits.view"] },
      { features: ["billing"] },
    );
    expect(access.sessions).toBe(false);
  });

  it("shows waiting list for FO with permission", () => {
    const access = resolveScheduleUtilityAccess(
      { role: "fo", permissions: ["waiting_list.view", "appointments.view"] },
      { features: ["online_booking", "billing"] },
    );
    expect(access.waitingList).toBe(true);
  });

  it("defines eight utility items", () => {
    expect(UTILITY_ITEMS).toHaveLength(8);
    expect(UTILITY_ITEMS.map((i) => i.id)).toEqual([
      "price_checker",
      "invoices",
      "pos",
      "sessions",
      "waiting_list",
      "daily_closing",
      "appointment_log",
      "legend",
    ]);
  });
});
