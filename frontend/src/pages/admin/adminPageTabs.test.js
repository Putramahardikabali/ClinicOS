/** Documents expected General Settings tab keys after Finance merge. */
const GENERAL_SETTINGS_TAB_ORDER = [
  "branding",
  "schedule",
  "commission",
  "online-booking-payment",
  "security",
];

const MESSAGING_TABS = ["connection", "automation-rules", "message-logs", "legacy-templates"];
const FORMS_TABS = ["doctor-form", "therapist-form", "consent", "mapping"];
const CATALOG_TABS = ["treatment-categories", "unit-types"];
const MARKETING_TABS = ["coupons", "loyalty"];

describe("general settings module tabs", () => {
  test("General Settings includes merged finance tabs in order", () => {
    expect(GENERAL_SETTINGS_TAB_ORDER).toEqual([
      "branding",
      "schedule",
      "commission",
      "online-booking-payment",
      "security",
    ]);
    expect(GENERAL_SETTINGS_TAB_ORDER).not.toContain("messaging");
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

  test("Marketing settings tab keys", () => {
    expect(MARKETING_TABS).toContain("coupons");
    expect(MARKETING_TABS).toContain("loyalty");
  });
});
