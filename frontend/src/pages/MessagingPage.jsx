import {
  MessageSquare, Users, FileText, Send, Zap, ScrollText, Settings2,
} from "lucide-react";
import { useAuth, hasPermission } from "@/lib/auth";
import SettingsModuleLayout from "@/components/settings/SettingsModuleLayout";
import { MessagingAutomationTab } from "@/pages/admin/settingsTabs";
import WhatsgoConnectionTab from "@/components/messaging/whatsgo/WhatsgoConnectionTab";
import WhatsgoContactSyncTab from "@/components/messaging/whatsgo/WhatsgoContactSyncTab";
import WhatsgoTemplatesTab from "@/components/messaging/whatsgo/WhatsgoTemplatesTab";
import WhatsgoSendTestTab from "@/components/messaging/whatsgo/WhatsgoSendTestTab";
import WhatsgoMessageLogsTab from "@/components/messaging/whatsgo/WhatsgoMessageLogsTab";
import WhatsgoAdvancedTab from "@/components/messaging/whatsgo/WhatsgoAdvancedTab";

export default function MessagingPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "super_admin";
  const isManager = user?.role === "manager";
  const canManage = (isOwner || isManager) && (hasPermission(user, "messaging.manage") || isOwner || isManager);
  const canSend = hasPermission(user, "messaging.send");
  const canViewLogs = hasPermission(user, "messaging.view") || canSend || canManage;
  const canAutomation =
    hasPermission(user, "messaging.automation.view")
    || hasPermission(user, "messaging.automation.manage")
    || isOwner
    || isManager;

  const tabs = [
    canManage && { key: "connection", label: "Connection", icon: MessageSquare },
    canManage && { key: "contact-sync", label: "Contact Sync", icon: Users },
    canManage && { key: "templates", label: "Templates", icon: FileText },
    (canManage || canSend) && { key: "send-test", label: "Send Test", icon: Send },
    canAutomation && { key: "automations", label: "Automations", icon: Zap },
    canViewLogs && { key: "message-logs", label: "Message Logs", icon: ScrollText },
    canManage && { key: "advanced", label: "Advanced", icon: Settings2 },
  ].filter(Boolean);

  return (
    <SettingsModuleLayout
      eyebrow="Settings"
      title="Whatsgo Integration"
      description="Connect ClinicOS with Whatsgo to sync patients, send WhatsApp templates, automate reminders, and open patient conversations."
      tabs={tabs}
      defaultTab="connection"
      testIdPrefix="whatsgo"
    >
      {(tab) => (
        <>
          {tab === "connection" && canManage && <WhatsgoConnectionTab />}
          {tab === "contact-sync" && canManage && <WhatsgoContactSyncTab />}
          {tab === "templates" && canManage && <WhatsgoTemplatesTab />}
          {tab === "send-test" && (canManage || canSend) && <WhatsgoSendTestTab />}
          {tab === "automations" && canAutomation && <MessagingAutomationTab />}
          {tab === "message-logs" && canViewLogs && <WhatsgoMessageLogsTab />}
          {tab === "advanced" && canManage && <WhatsgoAdvancedTab />}
        </>
      )}
    </SettingsModuleLayout>
  );
}
