import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCircle2, ExternalLink, MessageCircle, Receipt, Send } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { openWhatsgoChatSafe } from "@/lib/whatsgo";

export default function BookingMessagingMenu({
  booking,
  automationActive,
  canSendViaProvider,
  canWhatsgoSend,
  onSent,
  compact = false,
}) {
  const [busy, setBusy] = useState(false);
  const btnClass = compact ? "bl-btn-ghost text-xs inline-flex items-center gap-1.5" : "bl-btn-ghost text-sm inline-flex items-center gap-2";

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

  const waManual = () => {
    const phone = (booking.patient_phone || "").replace(/[^0-9]/g, "");
    if (!phone) {
      toast.error("No phone number on file");
      return;
    }
    const text = encodeURIComponent(
      `Hi ${booking.patient_name || ""}, regarding your appointment at ${booking.treatment || "our clinic"}.`,
    );
    window.open(`https://wa.me/${phone}?text=${text}`, "_blank", "noopener,noreferrer");
  };

  if (canSendViaProvider && automationActive) {
    return (
      <div className="flex flex-wrap gap-2" data-testid="booking-messaging-actions">
        <button type="button" className={btnClass} disabled={busy} onClick={() => sendTemplate("booking_reminder")} data-testid="send-reminder-btn">
          <Bell className="w-4 h-4" /> Send reminder
        </button>
        <button type="button" className={btnClass} disabled={busy} onClick={() => sendTemplate("booking_confirmation")} data-testid="send-confirmation-btn">
          <CheckCircle2 className="w-4 h-4" /> Send confirmation
        </button>
        {booking.invoice?.id && (
          <button type="button" className={btnClass} disabled={busy} onClick={() => sendTemplate("invoice")} data-testid="send-invoice-btn">
            <Receipt className="w-4 h-4" /> Send invoice
          </button>
        )}
        {canWhatsgoSend && booking.patient_id && (
          <button type="button" className={btnClass} disabled={busy} onClick={openWhatsgo} data-testid="open-whatsgo-chat-btn">
            <MessageCircle className="w-4 h-4" /> Open Whatsgo chat
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="booking-messaging-fallback">
      <button type="button" className={btnClass} disabled={busy} onClick={waManual}>
        <Send className="w-4 h-4" /> Open WhatsApp manually
      </button>
      {!automationActive && (
        <Link to="/messaging" className={`${btnClass} no-underline`}>
          <ExternalLink className="w-4 h-4" /> Connect Whatsgo
        </Link>
      )}
    </div>
  );
}
