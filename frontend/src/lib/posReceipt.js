import { fmtIDR } from "@/lib/posUtils";
import { describeGiftCardSaleItem, giftCardItemsFromSale } from "@/lib/posGiftCardSale";

export { printPosReceipt } from "@/lib/posReceiptPrint";
export { printPosGiftCards } from "@/lib/posGiftCardPrint";

export function buildPosReceiptWhatsAppText(sale, clinicName) {
  const lines = (sale.items || [])
    .map((it) => `• ${it.name_snapshot} × ${it.qty} — ${fmtIDR(it.total)}`)
    .join("\n");
  const giftLines = giftCardItemsFromSale(sale).map((it) => {
    const gc = describeGiftCardSaleItem(it);
    const extra = [
      gc.recipientName ? `Recipient: ${gc.recipientName}` : null,
      gc.expiryDate ? `Expiry: ${gc.expiryDate}` : null,
    ].filter(Boolean);
    return [`Gift card ${gc.code} (${gc.type})`, ...extra].join("\n  ");
  });
  return [
    `Receipt ${sale.sale_number} — ${clinicName}`,
    sale.patient_name_snapshot || sale.customer_name || "Customer",
    "",
    lines,
    ...(giftLines.length ? ["", "Gift cards:", ...giftLines.map((g) => `• ${g}`)] : []),
    "",
    `Total: ${fmtIDR(sale.total)}`,
    `Paid: ${fmtIDR(sale.amount_paid)} (${sale.payment_method || "cash"})`,
    "",
    "Thank you!",
  ].join("\n");
}

export function whatsAppLink(phone, text) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
