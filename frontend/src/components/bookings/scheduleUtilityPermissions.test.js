import { resolveScheduleUtilityAccess, UTILITY_ITEMS } from "./scheduleUtilityPermissions";

describe("scheduleUtilityPermissions", () => {
  const clinicWithBilling = {
    features: ["billing", "products", "treatments"],
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

  it("defines six utility items", () => {
    expect(UTILITY_ITEMS).toHaveLength(6);
  });
});
