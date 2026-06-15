import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  dismissReminderKeys,
  filterActiveReminders,
  groupReminders,
  loadDismissedReminderKeys,
} from "@/lib/appointmentReminders";
import { REALTIME_TOPICS } from "@/lib/realtimeEvents";
import { useRealtimeInvalidation } from "@/lib/realtimeEventsContext";

const FrontDeskReminderContext = createContext(null);

export function useFrontDeskReminders() {
  return useContext(FrontDeskReminderContext);
}

export function FrontDeskReminderProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const enabled = user?.role === "fo";

  const [reminders, setReminders] = useState([]);
  const [readOnly, setReadOnly] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [cardHidden, setCardHidden] = useState(false);
  const [dismissedMap, setDismissedMap] = useState(() => loadDismissedReminderKeys());
  const [busyId, setBusyId] = useState(null);

  const refreshReminders = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await api.get("/dashboard/front-desk/today");
      setReminders(r.data?.appointment_reminders || []);
      setReadOnly(!!r.data?.read_only);
    } catch {
      /* silent poll failures */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    refreshReminders();
    const poll = () => {
      if (document.visibilityState === "visible") refreshReminders();
    };
    const intervalId = setInterval(poll, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshReminders();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, refreshReminders]);

  useRealtimeInvalidation(REALTIME_TOPICS.FRONT_DESK, refreshReminders, enabled);

  const activeReminders = useMemo(
    () => (enabled ? filterActiveReminders(reminders, dismissedMap) : []),
    [enabled, reminders, dismissedMap],
  );
  const grouped = useMemo(() => groupReminders(activeReminders), [activeReminders]);

  useEffect(() => {
    if (activeReminders.length === 0) {
      setCardHidden(false);
    }
  }, [activeReminders.length]);

  const handleDismiss = useCallback((keys) => {
    const next = dismissReminderKeys(keys);
    setDismissedMap({ ...next });
    setCardHidden(true);
  }, []);

  const handleConfirm = useCallback(async (reminder) => {
    if (readOnly) return;
    setBusyId(reminder.booking_id);
    try {
      await api.put(`/bookings/${reminder.booking_id}/status`, { status: "confirmed" });
      toast.success("Appointment confirmed");
      await refreshReminders();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not confirm appointment");
    } finally {
      setBusyId(null);
    }
  }, [readOnly, refreshReminders]);

  const handleStartSession = useCallback(async (reminder) => {
    if (readOnly) return;
    setBusyId(reminder.booking_id);
    try {
      const r = await api.post(`/bookings/${reminder.booking_id}/start-visit`);
      toast.success("Treatment session started");
      await refreshReminders();
      const visitId = r.data?.visit?.id;
      if (visitId) navigate(`/visits/${visitId}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start session");
    } finally {
      setBusyId(null);
    }
  }, [readOnly, refreshReminders, navigate]);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const value = useMemo(() => ({
    enabled,
    reminders,
    readOnly,
    activeReminders,
    grouped,
    panelOpen,
    cardHidden,
    setCardHidden,
    busyId,
    refreshReminders,
    handleDismiss,
    handleConfirm,
    handleStartSession,
    openPanel,
    closePanel,
  }), [
    enabled,
    reminders,
    readOnly,
    activeReminders,
    grouped,
    panelOpen,
    cardHidden,
    busyId,
    refreshReminders,
    handleDismiss,
    handleConfirm,
    handleStartSession,
    openPanel,
    closePanel,
  ]);

  return (
    <FrontDeskReminderContext.Provider value={value}>
      {children}
    </FrontDeskReminderContext.Provider>
  );
}
