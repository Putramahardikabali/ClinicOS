import { Download, Smartphone } from "lucide-react";
import { useInstallApp } from "@/lib/installApp";

/**
 * @param {object} props
 * @param {boolean} [props.compact] - Sidebar / mobile account sheet: minimal inline panel
 * @param {boolean} [props.persistent] - Account profile page: same compact styling with light card
 */
export default function InstallAppPrompt({ compact = false, persistent = false }) {
  const {
    installed,
    canPromptInstall,
    showIosInstructions,
    bannerDismissed,
    dismissBanner,
    install,
  } = useInstallApp();

  const installable = canPromptInstall || showIosInstructions;
  const canShow = !installed && !bannerDismissed && installable;

  if (!canShow) return null;

  const handleInstall = async () => {
    await install();
  };

  const description = canPromptInstall
    ? "Open ClinicOS from your home screen."
    : "On iPhone: Share, then Add to Home Screen.";

  const content = (
    <>
      {compact ? (
        <Smartphone className="w-3.5 h-3.5 text-[var(--bl-sidebar-muted-text)] shrink-0 mt-0.5" strokeWidth={1.6} />
      ) : (
        <Download className="w-3.5 h-3.5 text-[var(--bl-muted-text)] shrink-0 mt-0.5" strokeWidth={1.6} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[var(--bl-sidebar-text)] leading-tight">Install app</div>
        <p className="text-[11px] text-[var(--bl-sidebar-muted-text)] leading-snug mt-0.5 line-clamp-2">{description}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {canPromptInstall && (
            <button
              type="button"
              onClick={handleInstall}
              className="bl-btn-primary inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
              data-testid="install-app-button"
            >
              <Download className="w-3 h-3" strokeWidth={2} />
              Install
            </button>
          )}
          <button
            type="button"
            onClick={dismissBanner}
            className="text-[11px] text-[var(--bl-sidebar-muted-text)] hover:text-[var(--bl-sidebar-text)] hover:underline underline-offset-2"
            data-testid="install-app-dismiss"
          >
            Later
          </button>
        </div>
      </div>
    </>
  );

  if (compact) {
    return (
      <div
        className="mt-2.5 pt-2.5 border-t border-[var(--bl-sidebar-border)]/70"
        data-testid="install-app-banner"
      >
        <div className="flex items-start gap-2">{content}</div>
      </div>
    );
  }

  return (
    <div
      className={
        persistent
          ? "mb-5 rounded-lg border p-2.5"
          : "mt-3 rounded-lg border p-2.5"
      }
      style={{
        borderColor: "var(--bl-border)",
        background: "color-mix(in srgb, var(--bl-background) 60%, var(--bl-surface))",
      }}
      data-testid={persistent ? "install-app-account" : "install-app-banner"}
    >
      <div className="flex items-start gap-2">{content}</div>
    </div>
  );
}
