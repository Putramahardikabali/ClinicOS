import { Download, Smartphone, CheckCircle2 } from "lucide-react";
import { useInstallApp } from "@/lib/installApp";

/**
 * @param {object} props
 * @param {boolean} [props.compact] - Sidebar compact banner
 * @param {boolean} [props.persistent] - Account page: always show install action when supported
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

  const showBanner = !persistent && !installed && !bannerDismissed && (canPromptInstall || showIosInstructions);
  const showPersistent = persistent && (installed || canPromptInstall || showIosInstructions);

  if (!showBanner && !showPersistent) return null;

  const handleInstall = async () => {
    const result = await install();
    if (result?.outcome === "unavailable" && showIosInstructions) return;
  };

  if (installed && persistent) {
    return (
      <div className="bl-card p-5 flex items-start gap-3" data-testid="install-app-installed">
        <CheckCircle2 className="w-5 h-5 text-[#52796F] shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-[#2D3A33]">ClinicOS is installed</div>
          <p className="text-sm text-[#5C6C62] mt-1">You are using the installed app experience.</p>
        </div>
      </div>
    );
  }

  const title = persistent ? "Install ClinicOS App" : "Install ClinicOS app";
  const body = canPromptInstall
    ? "Install ClinicOS for a faster, app-like experience on this device."
    : "To install ClinicOS on iPhone/iPad: tap Share, then Add to Home Screen.";

  return (
    <div
      className={
        compact
          ? "mt-2 p-3 rounded-lg border border-[#EAE6D7] bg-[#FBF8EF]"
          : persistent
            ? "bl-card p-5"
            : "mt-4 p-4 rounded-xl border border-[#EAE6D7] bg-[#FBF8EF]"
      }
      data-testid={persistent ? "install-app-account" : "install-app-banner"}
    >
      <div className="flex items-start gap-3">
        <Smartphone className="w-5 h-5 mt-0.5 text-[#5C6C62] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[#2D3A33]">{title}</div>
          <p className="mt-1 text-sm text-[#5C6C62] leading-relaxed">{body}</p>
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            {canPromptInstall && (
              <button
                type="button"
                onClick={handleInstall}
                className={persistent ? "bl-btn-primary text-sm inline-flex items-center gap-2" : "bl-btn-ghost text-sm inline-flex items-center gap-1"}
                data-testid="install-app-button"
              >
                <Download className="w-4 h-4" />
                {persistent ? "Install ClinicOS App" : "Install"}
              </button>
            )}
            {showBanner && (
              <button
                type="button"
                onClick={dismissBanner}
                className="text-xs text-[#5C6C62] underline underline-offset-2"
                data-testid="install-app-dismiss"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
