const BASE_ENV = { ...process.env };

function loadDemoModule(envPatch = {}) {
  jest.resetModules();
  process.env = { ...BASE_ENV, ...envPatch };
  // eslint-disable-next-line global-require
  return require("./demoAccounts");
}

describe("demoAccounts", () => {
  afterEach(() => {
    process.env = { ...BASE_ENV };
    jest.resetModules();
  });

  test("owner, fo, and doctor prefills use Demo Clinic emails when VITE password is set", () => {
    const mod = loadDemoModule({ VITE_DEMO_PASSWORD: "demo-secret" });
    const owner = mod.resolveDemoLoginPrefill("?demo=owner");
    const fo = mod.resolveDemoLoginPrefill("?demo=fo");
    const doctor = mod.resolveDemoLoginPrefill("?demo=doctor");

    expect(owner).toMatchObject({
      configured: true,
      email: "owner@democlinic.com",
      password: "demo-secret",
      label: "Owner",
    });
    expect(fo).toMatchObject({
      configured: true,
      email: "fo@democlinic.com",
      password: "demo-secret",
      label: "Front Office",
    });
    expect(doctor).toMatchObject({
      configured: true,
      email: "doctor1@democlinic.com",
      password: "demo-secret",
      label: "Doctor",
    });
  });

  test("REACT_APP_DEMO_PASSWORD fallback works for local CRA .env", () => {
    const mod = loadDemoModule({ REACT_APP_DEMO_PASSWORD: "local-secret" });
    expect(mod.isDemoAccountConfigured("owner")).toBe(true);
    expect(mod.resolveDemoLoginPrefill("?demo=owner")).toMatchObject({
      password: "local-secret",
    });
  });

  test("missing password marks role as not configured", () => {
    const mod = loadDemoModule({ VITE_DEMO_PASSWORD: "", REACT_APP_DEMO_PASSWORD: "" });
    expect(mod.isDemoAccountConfigured("owner")).toBe(false);
    expect(mod.resolveDemoLoginPrefill("?demo=owner")).toMatchObject({
      configured: false,
      roleKey: "owner",
    });
  });

  test("accounting is configured with default Demo Clinic email when password is set", () => {
    const mod = loadDemoModule({ VITE_DEMO_PASSWORD: "12345678" });
    expect(mod.isDemoAccountConfigured("accounting")).toBe(true);
    expect(mod.demoAccounts.accounting.email).toBe("acc@democlinic.com");
  });

  test("accounting is coming soon when email override is cleared", () => {
    const mod = loadDemoModule({
      VITE_DEMO_PASSWORD: "demo-secret",
      VITE_DEMO_ACCOUNTING_EMAIL: "",
    });
    expect(mod.isDemoAccountConfigured("accounting")).toBe(false);
  });

  test("normal login query returns null without demo param", () => {
    const mod = loadDemoModule({ VITE_DEMO_PASSWORD: "demo-secret" });
    expect(mod.resolveDemoLoginPrefill("")).toBeNull();
    expect(mod.resolveDemoLoginPrefill("?email=test@example.com")).toBeNull();
  });

  test("demo accounts never expose platform super admin email", () => {
    const mod = loadDemoModule({ VITE_DEMO_PASSWORD: "demo-secret" });
    Object.values(mod.demoAccounts).forEach((account) => {
      expect(account.email.toLowerCase()).not.toBe("platform@clinicos.id");
    });
  });

  test("demoLoginPath encodes role key", () => {
    const mod = loadDemoModule({ VITE_DEMO_PASSWORD: "x" });
    expect(mod.demoLoginPath("fo")).toBe("/login?demo=fo");
  });

  test("per-role VITE email override via env", () => {
    const mod = loadDemoModule({
      VITE_DEMO_PASSWORD: "pw",
      VITE_DEMO_OWNER_EMAIL: "custom.owner@democlinic.com",
    });
    expect(mod.demoAccounts.owner.email).toBe("custom.owner@democlinic.com");
    expect(mod.isDemoAccountConfigured("owner")).toBe(true);
  });
});
