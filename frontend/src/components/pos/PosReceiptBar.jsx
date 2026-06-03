import { MessageCircle, Printer } from "lucide-react";
import { fmtIDR } from "@/lib/posUtils";
import { saleHasGiftCardItems } from "@/lib/posGiftCardSale";
import { buildPosReceiptWhatsAppText, printPosGiftCards, printPosReceipt, whatsAppLink } from "@/lib/posReceipt";

export default function PosReceiptBar({
  sale,
  clinicName,
  messagingEnabled,
  canSendMessaging,
  customerPhone,
  onPrint,
}) {
  if (!sale || sale.status !== "paid") return null;

  const waText = buildPosReceiptWhatsAppText(sale, clinicName);
  const phone = customerPhone || sale.customer_phone;
  const waUrl = whatsAppLink(phone, waText);
  const showProviderSend = messagingEnabled && canSendMessaging;

  const hasGiftCards = saleHasGiftCardItems(sale);

  const handlePrint = () => {
    if (onPrint) onPrint();
    else printPosReceipt();
  };

  const handlePrintGiftCards = () => {
    printPosGiftCards();
  };

  return (
    <div className="bl-card p-4 border-2 border-[var(--bl-primary)]/30 bg-[#F8FAF8] no-print" data-testid="pos-receipt-bar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label-eyebrow text-[var(--bl-primary)]">Sale complete</div>
          <div className="font-display text-lg text-[#2D3A33]">{sale.sale_number}</div>
          <div className="text-sm text-[#5C6C62]">
            {fmtIDR(sale.total)} · {sale.payment_method}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"
            onClick={handlePrint}
            data-testid="pos-print-receipt"
          >
            <Printer className="w-4 h-4" /> Print receipt
          </button>
          {hasGiftCards && (
            <button
              type="button"
              className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"
              onClick={handlePrintGiftCards}
              data-testid="pos-print-gift-cards"
            >
              <Printer className="w-4 h-4" /> Print gift cards
            </button>
          )}
          {waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              className="bl-btn-primary text-sm inline-flex items-center gap-1.5"
              data-testid="pos-whatsapp-receipt"
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="bl-btn-ghost text-sm inline-flex items-center gap-1.5 opacity-50"
              title="Add customer phone to send via WhatsApp"
            >
              <MessageCircle className="w-4 h-4" /> WhatsApp
            </button>
          )}
        </div>
      </div>
      {showProviderSend && (
        <p className="text-xs text-[#5C6C62] mt-2">
          WhatsApp API automation is connected — receipt text is pre-filled when you open WhatsApp.
        </p>
      )}
      {!phone && (
        <p className="text-xs text-[#B45309] mt-1">
          No phone on file — enter walk-in phone or link a patient for WhatsApp.
        </p>
      )}
    </div>
  );
}
