import { resolveBrandingTheme } from "@/lib/clinicTheme";

/**
 * Live preview of grouped theme tokens in branding settings.
 */
export default function BrandingThemePreview({ branding }) {
  const theme = resolveBrandingTheme(branding);

  return (
    <div className="bl-card p-5 space-y-4" data-testid="branding-theme-preview">
      <div>
        <div className="font-display text-lg text-[var(--bl-text)]">Live preview</div>
        <p className="text-xs text-[var(--bl-muted-text)] mt-1">
          Derived colors update automatically when you change the base theme colors.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-[var(--bl-muted-text)]">Actions</div>
          <button type="button" className="bl-btn-primary w-full sm:w-auto" data-testid="branding-preview-primary-btn">
            Primary button
          </button>
          <div className="flex gap-1 p-0.5 rounded-lg bg-[var(--bl-primary-soft)] border border-[var(--bl-border)] w-fit">
            <span className="px-3 py-1.5 text-xs rounded-md bg-[var(--bl-surface)] shadow-sm text-[var(--bl-text)] font-medium">
              Active tab
            </span>
            <span className="px-3 py-1.5 text-xs rounded-md text-[var(--bl-muted-text)]">Tab</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-[var(--bl-muted-text)]">Navigation</div>
          <div
            className="bl-sidebar-link active max-w-[220px]"
            data-testid="branding-preview-sidebar-active"
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--bl-primary)" }} />
            Active sidebar item
          </div>
          <a href="#preview" className="text-sm font-medium" style={{ color: "var(--bl-link)" }} onClick={(e) => e.preventDefault()}>
            Active link
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[var(--bl-muted-text)]">Form focus</div>
          <input
            className="bl-input"
            readOnly
            value="Focused input preview"
            data-testid="branding-preview-input"
            onFocus={(e) => e.target.select()}
          />
          <p className="text-xs text-[var(--bl-muted-text)]">Helper / muted label text</p>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[var(--bl-muted-text)]">Public booking slot</div>
          <div className="flex gap-2">
            <span className="px-3 py-2 rounded-lg border text-sm text-[var(--bl-muted-text)] border-[var(--bl-border)] bg-[var(--bl-surface)]">
              Date
            </span>
            <span
              className="px-3 py-2 rounded-lg border text-sm font-medium shadow-sm"
              style={{
                borderColor: "var(--bl-primary)",
                background: "var(--bl-primary)",
                color: "var(--bl-primary-contrast)",
              }}
              data-testid="branding-preview-slot"
            >
              10:30
            </span>
          </div>
        </div>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ background: "var(--bl-surface)", borderColor: "var(--bl-border)" }}
        data-testid="branding-preview-card"
      >
        <div className="font-medium text-[var(--bl-text)]">Surface card</div>
        <p className="text-sm text-[var(--bl-muted-text)] mt-1">
          Cards, modals, and panels use Surface + Border on a {theme.background} page background.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] font-mono">
        {[
          ["Primary soft", theme.primary_soft],
          ["Border", theme.border_color],
          ["Muted", theme.muted_text],
          ["Contrast", theme.primary_contrast],
        ].map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5 min-w-0">
            <span className="w-4 h-4 rounded border border-[var(--bl-border)] shrink-0" style={{ background: color }} />
            <span className="truncate text-[var(--bl-muted-text)]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
