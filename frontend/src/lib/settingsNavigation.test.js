import { legacyAdminTabRedirect, LEGACY_ADMIN_TAB_REDIRECTS } from "./settingsNavigation";

describe("settingsNavigation", () => {
  test("maps legacy admin tabs to new module routes", () => {
    expect(legacyAdminTabRedirect("messaging")).toBe("/messaging");
    expect(legacyAdminTabRedirect("messaging_automation")).toBe("/messaging?tab=automation-rules");
    expect(legacyAdminTabRedirect("doctor-form")).toBe("/visit-settings?tab=doctor-form");
    expect(legacyAdminTabRedirect("mapping")).toBe("/visit-settings?tab=mapping");
    expect(legacyAdminTabRedirect("commission")).toBe("/finance-settings?tab=commission");
    expect(legacyAdminTabRedirect("inventory")).toBe("/products?tab=inventory-settings");
  });

  test("unknown tab returns null", () => {
    expect(legacyAdminTabRedirect("branding")).toBeNull();
    expect(legacyAdminTabRedirect("")).toBeNull();
  });

  test("redirect map includes automation alias", () => {
    expect(LEGACY_ADMIN_TAB_REDIRECTS.automation).toContain("automation-rules");
  });
});
