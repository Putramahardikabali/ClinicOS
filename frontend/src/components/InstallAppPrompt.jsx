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
        <Smartphone className="w-3.5 h-3.5 text-[#9AA89E] shrink-0 mt-0.5" strokeWidth={1.6} />
      ) : (
        <Download className="w-3.5 h-3.5 text-[#9AA89E] shrink-0 mt-0.5" strokeWidth={1.6} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[#3D4A43] leading-tight">Install app</div>
        <p className="text-[11px] text-[#8A9A8F] leading-snug mt-0.5 line-clamp-2">{description}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {canPromptInstall && (
            <button
              type="button"
              onClick={handleInstall}
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ background: "var(--bl-primary)" }}
              data-testid="install-app-button"
            >
              <Download className="w-3 h-3" strokeWidth={2} />
              Install
            </button>
          )}
          <button
            type="button"
            onClick={dismissBanner}
            className="text-[11px] text-[#8A9A8F] hover:text-[#5C6C62] hover:underline underline-offset-2"
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
        className="mt-2.5 pt-2.5 border-t border-[#EAE6D7]/70"
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
          ? "mb-5 rounded-lg border border-[#EAE6D7]/70 bg-[#FAF8F2]/60 p-2.5"
          : "mt-3 rounded-lg border border-[#EAE6D7]/70 bg-[#FAF8F2]/60 p-2.5"
      }
      data-testid={persistent ? "install-app-account" : "install-app-banner"}
    >
      <div className="flex items-start gap-2">{content}</div>
    </div>
  );
}
