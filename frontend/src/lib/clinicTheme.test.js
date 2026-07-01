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

  it("derives sidebar and secondary action tokens", () => {
    const theme = resolveBrandingTheme({
      primary_color: "#E91E8C",
      sidebar_background: "#1A1020",
      sidebar_active: "#3D2040",
      surface: "#FFFFFF",
      text_primary: "#222222",
      background: "#FAFAFA",
    });
    expect(theme.sidebar_bg).toBe("#1A1020");
    expect(theme.sidebar_active_resolved).toBe("#3D2040");
    expect(theme.sidebar_text).toBeTruthy();
    expect(theme.sidebar_muted_text).not.toBe(theme.sidebar_text);
    expect(theme.action_secondary_bg).toBe(theme.surface);
    expect(theme.action_secondary_border).toBe(theme.border_color);
    expect(theme.table_header_bg).not.toBe(theme.primary_soft);
    expect(theme.table_row_hover).not.toBe(theme.primary_soft);
  });

  it("falls back sidebar colors when unset", () => {
    const theme = resolveBrandingTheme({
      primary_color: "#336699",
      surface: "#FFFFFF",
      background: "#FDFBF7",
      text_primary: "#222222",
    });
    expect(theme.sidebar_bg).toBeTruthy();
    expect(theme.sidebar_active_resolved).toBe(theme.primary_soft);
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
      sidebar_background: "#1A1A1A",
    });
    expect(saved.primary_color).toBe("#112233");
    expect(saved.primary_hover).toBeUndefined();
    expect(saved.sidebar_background).toBe("#1A1A1A");
    expect(saved.sidebar_active).toBeUndefined();
    expect(Object.keys(saved)).toEqual([
      "clinic_name",
      "tagline",
      "logo_path",
      "primary_color",
      "accent_color",
      "background",
      "surface",
      "text_primary",
      "sidebar_background",
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
