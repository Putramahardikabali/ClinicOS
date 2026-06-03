import { useEffect, useMemo, useState } from "react";
import { Download, Smartphone } from "lucide-react";

const DISMISS_KEY = "clinicos_install_prompt_dismissed";

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator?.standalone === true;
}

function isIosSafari() {
  const ua = window.navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const webkit = /WebKit/.test(ua);
  const isCriOS = /CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit && !isCriOS;
}

export default function InstallAppPrompt({ compact = false }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(localStorage.getItem(DISMISS_KEY) === "1");
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const showIosHelp = useMemo(() => !installed && !dismissed && !deferredPrompt && isIosSafari(), [installed, dismissed, deferredPrompt]);
  const showInstallButton = !installed && !dismissed && !!deferredPrompt;
  if (!showIosHelp && !showInstallButton) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    setDeferredPrompt(null);
  };

  return (
    <div className={compact ? "mt-2 p-3 rounded-lg border border-[#EAE6D7] bg-[#FBF8EF]" : "mt-4 p-4 rounded-xl border border-[#EAE6D7] bg-[#FBF8EF]"}>
      <div className="flex items-start gap-2">
        <Smartphone className="w-4 h-4 mt-0.5 text-[#5C6C62]" />
        <div className="flex-1 text-sm text-[#2D3A33]">
          <div className="font-medium">Install ClinicOS app</div>
          {showInstallButton ? (
            <div className="mt-0.5 text-[#5C6C62]">Install ClinicOS for a faster app-like experience.</div>
          ) : (
            <div className="mt-0.5 text-[#5C6C62]">To install on iPhone/iPad: tap Share, then Add to Home Screen.</div>
          )}
          <div className="mt-2 flex gap-2">
            {showInstallButton && (
              <button type="button" onClick={install} className="bl-btn-ghost text-sm inline-flex items-center gap-1">
                <Download className="w-4 h-4" /> Install
              </button>
            )}
            <button type="button" onClick={dismiss} className="text-xs text-[#5C6C62] underline underline-offset-2">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
