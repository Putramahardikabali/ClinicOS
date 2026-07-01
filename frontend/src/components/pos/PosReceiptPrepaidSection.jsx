import { fmtIDR } from "@/lib/posUtils";
import { describePrepaidSaleItem, prepaidItemsFromSale } from "@/lib/posPrepaid";

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

export default function PosReceiptPrepaidSection({ sale }) {
  const items = prepaidItemsFromSale(sale);
  if (!items.length) return null;

  return (
    <section
      className="mt-4 pt-3 border-t-2 border-[#2D3A33] text-xs"
      data-testid="pos-receipt-prepaid"
    >
      <h2 className="text-[10px] uppercase tracking-[0.2em] text-[#5C6C62] font-semibold mb-3">
        Prepaid purchase
      </h2>
      <p className="text-[10px] text-[#8A9A86] mb-2">
        Liability recorded — not recognized as revenue until redeemed.
      </p>
      <div className="space-y-3">
        {items.map((it, idx) => {
          const pp = describePrepaidSaleItem(it);
          return (
            <div
              key={it.prepaid_id || it.id || `pp-${idx}`}
              className="rounded-lg border border-[#EAE6D7] p-2.5 bg-[#F8F5EC]/50"
            >
              <div className="flex justify-between gap-2">
                <span className="text-[#5C6C62]">Code</span>
                <span className="font-mono font-semibold" data-testid="pos-receipt-prepaid-code">
                  {pp.code}
                </span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span className="text-[#5C6C62]">Type</span>
                <span>{pp.typeLabel}</span>
              </div>
              {pp.treatmentName && (
                <div className="flex justify-between gap-2 mt-1">
                  <span className="text-[#5C6C62]">Treatment</span>
                  <span className="text-right">{pp.treatmentName}</span>
                </div>
              )}
              <div className="flex justify-between gap-2 mt-1">
                <span className="text-[#5C6C62]">Value</span>
                <span className="font-mono">{fmtIDR(pp.amountIdr)}</span>
              </div>
              {pp.expiryDate && (
                <div className="flex justify-between gap-2 mt-1">
                  <span className="text-[#5C6C62]">Expiry</span>
                  <span>{formatExpiry(pp.expiryDate)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
