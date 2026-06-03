import { fmtIDR } from "@/lib/posUtils";
import { describeGiftCardSaleItem, giftCardItemsFromSale } from "@/lib/posGiftCardSale";

function formatExpiry(iso) {
  if (!iso) return null;
  try {
    return new Date(iso.slice(0, 10)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function PosReceiptGiftCardsSection({ sale }) {
  const items = giftCardItemsFromSale(sale);
  if (!items.length) return null;

  return (
    <section
      className="mt-4 pt-3 border-t-2 border-[#2D3A33] text-xs"
      data-testid="pos-receipt-gift-cards"
    >
      <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#5C6C62] font-semibold mb-3">
        Gift cards issued
      </h2>
      <div className="space-y-3">
        {items.map((it, idx) => {
          const gc = describeGiftCardSaleItem(it);
          return (
            <div
              key={it.gift_card_id || it.id || `gc-${idx}`}
              className="rounded-lg border border-[#EAE6D7] p-2.5 bg-[#F8F5EC]/50"
            >
              <div className="flex justify-between gap-2">
                <span className="text-[#5C6C62]">Code</span>
                <span className="font-mono font-semibold" data-testid="pos-receipt-gift-code">
                  {gc.code}
                </span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="text-[#5C6C62]">Type</span>
                <span>{gc.type}</span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="text-[#5C6C62]">Status</span>
                <span data-testid="pos-receipt-gift-status">{gc.statusLabel}</span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="text-[#5C6C62]">Value</span>
                <span className="font-mono text-right">
                  {gc.gcType === "value_credit" ? fmtIDR(gc.valueIdr) : gc.valueLabel}
                </span>
              </div>
              {gc.recipientName && (
                <div className="flex justify-between gap-2 mt-1">
                  <span className="text-[#5C6C62]">Recipient</span>
                  <span className="text-right">{gc.recipientName}</span>
                </div>
              )}
              {gc.expiryDate && (
                <div className="flex justify-between gap-2 mt-1">
                  <span className="text-[#5C6C62]">Expiry</span>
                  <span>{formatExpiry(gc.expiryDate)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
