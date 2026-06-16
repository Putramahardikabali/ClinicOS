import { useState } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { openWhatsgoChatSafe, syncPatientToWhatsgoSafe } from "@/lib/whatsgo";

export default function WhatsgoPatientActions({
  patientId,
  canSend = false,
  className = "",
  compact = false,
}) {
  const [syncing, setSyncing] = useState(false);
  const [opening, setOpening] = useState(false);

  if (!canSend || !patientId) return null;

  const sync = async () => {
    setSyncing(true);
    try {
      await syncPatientToWhatsgoSafe(patientId);
    } finally {
      setSyncing(false);
    }
  };

  const openChat = async () => {
    setOpening(true);
    try {
      await openWhatsgoChatSafe(patientId);
    } finally {
      setOpening(false);
    }
  };

  const btnClass = compact ? "bl-btn-ghost text-xs inline-flex items-center gap-1.5" : "bl-btn-secondary text-sm inline-flex items-center gap-2";

  return (
    <div className={`flex flex-wrap gap-2 ${className}`} data-testid="whatsgo-patient-actions">
      <button type="button" onClick={sync} disabled={syncing} className={btnClass} data-testid="whatsgo-sync-patient">
        <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
        {compact ? "Sync" : "Sync to Whatsgo"}
      </button>
      <button type="button" onClick={openChat} disabled={opening} className={btnClass} data-testid="whatsgo-open-chat">
        <MessageCircle className="w-3.5 h-3.5" />
        {compact ? "Whatsgo" : "Open Whatsgo chat"}
      </button>
    </div>
  );
}
