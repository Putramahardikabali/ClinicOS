import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCircle2, MessageCircle, Receipt } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { openWhatsgoChatSafe } from "@/lib/whatsgo";

export default function BookingMessagingMenu({
  booking,
  automationActive,
  canSendViaProvider,
  canWhatsgoSend,
  onSent,
}) {
  const [busy, setBusy] = useState(false);
  const whatsgoConnected = !!(canSendViaProvider && automationActive);

  const sendTemplate = async (templateType) => {
    setBusy(true);
    try {
      await api.post("/messaging/send", { booking_id: booking.id, template_type: templateType });
      toast.success("Message sent");
      onSent?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Send failed");
    } finally {
      setBusy(false);
    }
  };

  const openWhatsgo = async () => {
    if (!booking.patient_id) {
      toast.error("Link patient record to open Whatsgo chat");
      return;
    }
    setBusy(true);
    try {
      await openWhatsgoChatSafe(booking.patient_id);
    } finally {
      setBusy(false);
    }
  };

  if (!whatsgoConnected) {
    return (
      <div className="text-xs text-[#5C6C62] space-y-1" data-testid="booking-messaging-unavailable">
        <p>Messaging is not available. Connect Whatsgo to send reminders and invoices.</p>
        <Link to="/messaging" className="text-[#52796F] hover:underline inline-block">
          Connect Whatsgo
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="booking-messaging-actions">
      <button
        type="button"
        className="bl-btn-ghost text-xs inline-flex items-center gap-1.5"
        disabled={busy}
        onClick={() => sendTemplate("booking_reminder")}
        data-testid="send-reminder-btn"
      >
        <Bell className="w-3.5 h-3.5" /> Send reminder
      </button>
      <button
        type="button"
        className="bl-btn-ghost text-xs inline-flex items-center gap-1.5"
        disabled={busy}
        onClick={() => sendTemplate("booking_confirmation")}
        data-testid="send-confirmation-btn"
      >
        <CheckCircle2 className="w-3.5 h-3.5" /> Send confirmation
      </button>
      {booking.invoice?.id && (
        <button
          type="button"
          className="bl-btn-ghost text-xs inline-flex items-center gap-1.5"
          disabled={busy}
          onClick={() => sendTemplate("invoice")}
          data-testid="send-invoice-btn"
        >
          <Receipt className="w-3.5 h-3.5" /> Send invoice
        </button>
      )}
      {canWhatsgoSend && booking.patient_id && (
        <button
          type="button"
          className="bl-btn-ghost text-xs inline-flex items-center gap-1.5"
          disabled={busy}
          onClick={openWhatsgo}
          data-testid="open-whatsgo-chat-btn"
        >
          <MessageCircle className="w-3.5 h-3.5" /> Open Whatsgo chat
        </button>
      )}
    </div>
  );
}
