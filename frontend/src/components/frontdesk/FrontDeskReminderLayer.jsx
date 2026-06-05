import { useFrontDeskReminders } from "@/lib/frontDeskReminderContext";
import { AppointmentRemindersFloatingCard } from "@/components/frontdesk/AppointmentReminders";

/** Persistent FO reminder popup — mounted from AppShell. */
export default function FrontDeskReminderLayer() {
  const ctx = useFrontDeskReminders();
  if (!ctx?.enabled || ctx.readOnly) return null;
  return <AppointmentRemindersFloatingCard />;
}
