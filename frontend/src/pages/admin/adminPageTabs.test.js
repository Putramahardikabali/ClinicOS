/** Documents expected Admin Settings tab keys after navigation refactor. */
const ADMIN_CORE_TABS = ["branding", "schedule", "security"];

const MESSAGING_TABS = ["connection", "automation-rules", "message-logs", "legacy-templates"];
const FORMS_TABS = ["doctor-form", "therapist-form", "consent", "mapping"];
const CATALOG_TABS = ["treatment-categories", "unit-types"];
const FINANCE_TABS = ["commission", "online-booking-payment", "coupons", "loyalty"];

describe("admin settings module tabs", () => {
  test("Admin Settings shows only core clinic-wide tabs", () => {
    expect(ADMIN_CORE_TABS).toEqual(["branding", "schedule", "security"]);
    expect(ADMIN_CORE_TABS).not.toContain("messaging");
    expect(ADMIN_CORE_TABS).not.toContain("commission");
  });

  test("Messaging module tab keys", () => {
    expect(MESSAGING_TABS).toContain("connection");
    expect(MESSAGING_TABS).toContain("automation-rules");
    expect(MESSAGING_TABS).toContain("message-logs");
    expect(MESSAGING_TABS).toContain("legacy-templates");
  });

  test("Forms module tab keys", () => {
    expect(FORMS_TABS).toEqual(expect.arrayContaining(["doctor-form", "therapist-form", "consent", "mapping"]));
  });

  test("Catalog settings tab keys", () => {
    expect(CATALOG_TABS).toEqual(["treatment-categories", "unit-types"]);
  });

  test("Finance settings tab keys", () => {
    expect(FINANCE_TABS).toContain("commission");
    expect(FINANCE_TABS).toContain("online-booking-payment");
  });
});
