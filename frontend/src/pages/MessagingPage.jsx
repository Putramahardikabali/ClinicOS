import { MessageSquare, Zap, ScrollText, FileText } from "lucide-react";
import { useAuth, hasPermission } from "@/lib/auth";
import SettingsModuleLayout from "@/components/settings/SettingsModuleLayout";
import {
  MessagingSettingsTab,
  MessagingAutomationTab,
  MessagingLogsTab,
  MessagingTemplatesTab,
} from "@/pages/admin/settingsTabs";

export default function MessagingPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "super_admin";
  const isManager = user?.role === "manager";
  const canManage = hasPermission(user, "messaging.manage") || isOwner || isManager;
  const canSend = hasPermission(user, "messaging.send");
  const canViewLogs = hasPermission(user, "messaging.view") || canSend || canManage;
  const canAutomation =
    hasPermission(user, "messaging.automation.view")
    || hasPermission(user, "messaging.automation.manage")
    || isOwner
    || isManager;

  const tabs = [
    canManage && { key: "connection", label: "Connection", icon: MessageSquare },
    canAutomation && { key: "automation-rules", label: "Automation Rules", icon: Zap },
    canViewLogs && { key: "message-logs", label: "Message Logs", icon: ScrollText },
    canManage && { key: "legacy-templates", label: "Legacy Templates / Advanced", icon: FileText },
  ].filter(Boolean);

  return (
    <SettingsModuleLayout
      eyebrow="Communication"
      title="Messaging"
      description={canManage ? "Connect WhatsApp, configure automation rules, and review message history." : "Review message history and operational messaging activity."}
      tabs={tabs}
      defaultTab="connection"
      testIdPrefix="messaging"
    >
      {(tab) => (
        <>
          {tab === "connection" && canManage && <MessagingSettingsTab />}
          {tab === "automation-rules" && canAutomation && <MessagingAutomationTab />}
          {tab === "message-logs" && canViewLogs && <MessagingLogsTab />}
          {tab === "legacy-templates" && canManage && <MessagingTemplatesTab showLogs={false} />}
        </>
      )}
    </SettingsModuleLayout>
  );
}
