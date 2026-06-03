import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const DISMISS_KEY = "clinicos_install_prompt_dismissed";

const InstallAppContext = createContext(null);

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

export function InstallAppProvider({ children }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    const onBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismissBanner = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, "1");
    setBannerDismissed(true);
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return { outcome: "unavailable" };
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    if (choice?.outcome === "accepted") {
      setDeferredPrompt(null);
      setInstalled(true);
    }
    return choice;
  }, [deferredPrompt]);

  const value = useMemo(
    () => ({
      installed,
      deferredPrompt,
      canPromptInstall: !installed && !!deferredPrompt,
      showIosInstructions: !installed && !deferredPrompt && isIosSafari(),
      bannerDismissed,
      dismissBanner,
      install,
    }),
    [installed, deferredPrompt, bannerDismissed, dismissBanner, install],
  );

  return (
    <InstallAppContext.Provider value={value}>
      {children}
    </InstallAppContext.Provider>
  );
}

export function useInstallApp() {
  return useContext(InstallAppContext) || {
    installed: false,
    canPromptInstall: false,
    showIosInstructions: false,
    bannerDismissed: true,
    dismissBanner: () => {},
    install: async () => ({ outcome: "unavailable" }),
  };
}
