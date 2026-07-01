import { Ban } from "lucide-react";
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ background: "var(--bl-sidebar-bg)", borderColor: "var(--bl-sidebar-border)" }}
          data-testid="branding-preview-sidebar"
        >
          <div className="text-[10px] uppercase tracking-widest text-[var(--bl-sidebar-muted-text)]">Sidebar</div>
          <div className="bl-sidebar-link max-w-[240px]">
            <span className="w-2 h-2 rounded-full shrink-0 bg-[var(--bl-sidebar-muted-text)]" />
            Dashboard
          </div>
          <div className="bl-sidebar-link active max-w-[240px]" data-testid="branding-preview-sidebar-active">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--bl-sidebar-active-text)" }} />
            Active sidebar item
          </div>
          <div className="bl-sidebar-link active max-w-[240px]" data-testid="branding-preview-settings-parent">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--bl-sidebar-active-text)" }} />
            Settings (expanded)
          </div>
          <div className="ml-4 bl-sidebar-link active max-w-[220px] text-[13px] !py-2" data-testid="branding-preview-settings-child">
            General
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-[var(--bl-muted-text)]">Actions</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="bl-btn-primary text-sm" data-testid="branding-preview-primary-btn">
              New appointment
            </button>
            <button type="button" className="bl-btn-secondary text-sm inline-flex items-center gap-1.5" data-testid="branding-preview-secondary-btn">
              <Ban className="w-3.5 h-3.5" /> Block time
            </button>
          </div>
          <div className="bl-segmented w-fit" data-testid="branding-preview-segmented">
            <button type="button" className="bl-segmented-item active">Schedule</button>
            <button type="button" className="bl-segmented-item">List</button>
          </div>
          <div className="bl-segmented w-fit">
            <button type="button" className="bl-segmented-item active text-xs">Horizontal</button>
            <button type="button" className="bl-segmented-item text-xs">Vertical</button>
          </div>
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
              className="px-3 py-2 rounded-lg border text-sm font-medium shadow-sm bl-surface-selected-solid"
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
          ["Sidebar active", theme.sidebar_active_resolved],
          ["Sidebar text", theme.sidebar_text],
          ["Secondary bg", theme.action_secondary_bg],
          ["Secondary hover", theme.action_secondary_hover_bg],
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
