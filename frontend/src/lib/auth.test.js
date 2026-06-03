jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

import { can, hasPermission, canViewAllCommission, canViewOwnCommission, canManageCommission, canSubscribeBilling, canViewSaasBilling } from "./auth";

describe("patient bulk permission aliases", () => {
  const foUser = {
    role: "fo",
    permissions: ["patients.view", "patients.create", "patients.edit", "patients.export"],
  };
  const managerUser = {
    role: "manager",
    permissions: ["patients.view", "patients.create", "patients.edit", "patients.export"],
  };
  const doctorUser = {
    role: "doctor",
    permissions: ["patients.view_assigned", "clinical_records.view"],
  };
  const exportOnlyUser = {
    role: "custom_exporter",
    permissions: ["patients.view", "patients.export"],
  };
  const ownerUser = { role: "super_admin", permissions: [] };

  test("export_patients requires patients.export", () => {
    expect(can(foUser, "export_patients")).toBe(true);
    expect(can(managerUser, "export_patients")).toBe(true);
    expect(can(doctorUser, "export_patients")).toBe(false);
    expect(can(exportOnlyUser, "export_patients")).toBe(true);
    expect(can(ownerUser, "export_patients")).toBe(true);
  });

  test("create_patient gates import and new patient actions", () => {
    expect(can(foUser, "create_patient")).toBe(true);
    expect(can(doctorUser, "create_patient")).toBe(false);
    expect(can(exportOnlyUser, "create_patient")).toBe(false);
  });

  test("edit_patient requires patients.edit", () => {
    expect(can(foUser, "edit_patient")).toBe(true);
    expect(can(doctorUser, "edit_patient")).toBe(false);
    expect(hasPermission(doctorUser, "patients.edit")).toBe(false);
  });

  test("delete_patient requires patients.delete", () => {
    expect(can(foUser, "delete_patient")).toBe(false);
    expect(can(ownerUser, "delete_patient")).toBe(true);
  });
});

describe("commission permission helpers", () => {
  const managerUser = {
    role: "manager",
    permissions: ["commission.view", "commission.manage"],
  };
  const doctorUser = {
    role: "doctor",
    permissions: ["commission.view_own"],
  };
  const foUser = { role: "fo", permissions: ["billing.view"] };

  test("canViewAllCommission", () => {
    expect(canViewAllCommission(managerUser)).toBe(true);
    expect(canViewAllCommission(doctorUser)).toBe(false);
    expect(canViewAllCommission(foUser)).toBe(false);
  });

  test("canViewOwnCommission", () => {
    expect(canViewOwnCommission(doctorUser)).toBe(true);
    expect(canViewOwnCommission(foUser)).toBe(false);
  });

  test("canManageCommission", () => {
    expect(canManageCommission(managerUser)).toBe(true);
    expect(canManageCommission(doctorUser)).toBe(false);
  });
});

describe("subscription billing permissions", () => {
  const ownerUser = { role: "super_admin", permissions: [] };
  const managerUser = { role: "manager", permissions: ["billing.subscribe"] };
  const foUser = { role: "fo", permissions: ["billing.view", "billing.create"] };
  const customUser = { role: "custom", permissions: ["billing.subscribe"] };

  test("canSubscribeBilling", () => {
    expect(canSubscribeBilling(ownerUser)).toBe(true);
    expect(canSubscribeBilling(managerUser)).toBe(true);
    expect(canSubscribeBilling(customUser)).toBe(true);
    expect(canSubscribeBilling(foUser)).toBe(false);
    expect(canSubscribeBilling(null)).toBe(false);
  });

  test("canViewSaasBilling", () => {
    const viewOnlyUser = { role: "custom", permissions: ["billing.subscription_view"] };
    const invoiceOnlyUser = { role: "fo", permissions: ["billing.view"] };
    expect(canViewSaasBilling(ownerUser)).toBe(true);
    expect(canViewSaasBilling(viewOnlyUser)).toBe(true);
    expect(canViewSaasBilling(customUser)).toBe(true);
    expect(canViewSaasBilling(invoiceOnlyUser)).toBe(false);
    expect(canViewSaasBilling({ role: "doctor", permissions: [] })).toBe(false);
  });
});
