import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation } from "react-router-dom";

const AppointmentWorkspaceContext = createContext(null);

function isBookingsPath(pathname) {
  return pathname === "/bookings" || pathname.startsWith("/bookings/");
}

export function AppointmentWorkspaceProvider({ children }) {
  const loc = useLocation();
  const isAppointmentWorkspace = isBookingsPath(loc.pathname);
  const [isNavigationDrawerOpen, setIsNavigationDrawerOpen] = useState(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    onFsChange();
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    setIsNavigationDrawerOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (!isNavigationDrawerOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setIsNavigationDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isNavigationDrawerOpen]);

  const openNavigationDrawer = useCallback(() => setIsNavigationDrawerOpen(true), []);
  const closeNavigationDrawer = useCallback(() => setIsNavigationDrawerOpen(false), []);
  const toggleNavigationDrawer = useCallback(
    () => setIsNavigationDrawerOpen((open) => !open),
    [],
  );

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
      isAppointmentWorkspace,
      isNavigationDrawerOpen,
      isBrowserFullscreen,
      openNavigationDrawer,
      closeNavigationDrawer,
      toggleNavigationDrawer,
      toggleBrowserFullscreen,
    }),
    [
      isAppointmentWorkspace,
      isNavigationDrawerOpen,
      isBrowserFullscreen,
      openNavigationDrawer,
      closeNavigationDrawer,
      toggleNavigationDrawer,
      toggleBrowserFullscreen,
    ],
  );

  return (
    <AppointmentWorkspaceContext.Provider value={value}>
      {children}
    </AppointmentWorkspaceContext.Provider>
  );
}

export function useAppointmentWorkspace() {
  const ctx = useContext(AppointmentWorkspaceContext);
  if (!ctx) {
    return {
      isAppointmentWorkspace: false,
      isNavigationDrawerOpen: false,
      isBrowserFullscreen: false,
      openNavigationDrawer: () => {},
      closeNavigationDrawer: () => {},
      toggleNavigationDrawer: () => {},
      toggleBrowserFullscreen: async () => {},
    };
  }
  return ctx;
}
