import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router-dom";

export const SCHEDULE_FOCUS_MODE_STORAGE_KEY = "clinicOS.scheduleFocusMode";

const ScheduleFocusModeContext = createContext(null);

export function ScheduleFocusModeProvider({ children }) {
  const loc = useLocation();
  const isBookingsRoute = loc.pathname === "/bookings" || loc.pathname.startsWith("/bookings/");
  const [isScheduleFocusMode, setIsScheduleFocusMode] = useState(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    onFsChange();
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (!isBookingsRoute) {
      setIsScheduleFocusMode(false);
    }
  }, [isBookingsRoute]);

  const persistFocusPreference = useCallback((active) => {
    try {
      localStorage.setItem(SCHEDULE_FOCUS_MODE_STORAGE_KEY, active ? "true" : "false");
    } catch {
      /* ignore */
    }
  }, []);

  const enterFocusMode = useCallback(() => {
    setIsScheduleFocusMode(true);
    persistFocusPreference(true);
  }, [persistFocusPreference]);

  const exitFocusMode = useCallback(async () => {
    setIsScheduleFocusMode(false);
    persistFocusPreference(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
    }
  }, [persistFocusPreference]);

  const toggleBrowserFullscreen = useCallback(async (element) => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (element?.requestFullscreen) {
        await element.requestFullscreen();
      }
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      isScheduleFocusMode,
      isBrowserFullscreen,
      enterFocusMode,
      exitFocusMode,
      toggleBrowserFullscreen,
    }),
    [
      isScheduleFocusMode,
      isBrowserFullscreen,
      enterFocusMode,
      exitFocusMode,
      toggleBrowserFullscreen,
    ],
  );

  return (
    <ScheduleFocusModeContext.Provider value={value}>
      {children}
    </ScheduleFocusModeContext.Provider>
  );
}

export function useScheduleFocusMode() {
  const ctx = useContext(ScheduleFocusModeContext);
  if (!ctx) {
    return {
      isScheduleFocusMode: false,
      isBrowserFullscreen: false,
      enterFocusMode: () => {},
      exitFocusMode: async () => {},
      toggleBrowserFullscreen: async () => {},
    };
  }
  return ctx;
}

export function readScheduleFocusModePreference() {
  try {
    return localStorage.getItem(SCHEDULE_FOCUS_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
