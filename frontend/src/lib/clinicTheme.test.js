import {
  brandingBaseForSave,
  darkenHex,
  mixHex,
  resolveBrandingTheme,
} from "./clinicTheme";

describe("clinicTheme", () => {
  it("derives hover, soft, border, and muted from primary", () => {
    const theme = resolveBrandingTheme({
      primary_color: "#336699",
      accent_color: "#D4A373",
      background: "#FDFBF7",
      surface: "#FFFFFF",
      text_primary: "#222222",
    });
    expect(theme.primary_hover).not.toBe(theme.primary_color);
    expect(theme.primary_soft).not.toBe(theme.primary_color);
    expect(theme.border_color).toMatch(/^#[0-9A-F]{6}$/);
    expect(theme.muted_text).not.toBe(theme.text_primary);
    expect(theme.link_color).toBe(theme.primary_color);
    expect(theme.primary_contrast).toBeTruthy();
  });

  it("save payload keeps only base branding fields", () => {
    const saved = brandingBaseForSave({
      primary_color: "#112233",
      primary_hover: "#000000",
      accent_color: "#ABCDEF",
      background: "#FAFAFA",
      surface: "#FFFFFF",
      text_primary: "#111111",
      clinic_name: "Test Clinic",
    });
    expect(saved.primary_color).toBe("#112233");
    expect(saved.primary_hover).toBeUndefined();
    expect(Object.keys(saved)).toEqual([
      "clinic_name",
      "tagline",
      "logo_path",
      "primary_color",
      "accent_color",
      "background",
      "surface",
      "text_primary",
    ]);
  });

  it("mixHex blends toward second color", () => {
    expect(mixHex("#000000", "#FFFFFF", 0)).toBe("#FFFFFF");
    expect(mixHex("#000000", "#FFFFFF", 1)).toBe("#000000");
  });

  it("darkenHex reduces luminance", () => {
    const darker = darkenHex("#8A9A86", 0.2);
    expect(darker).not.toBe("#8A9A86");
  });
});
