import { PAYMENT_METHODS, TYPE_LABELS, fmtIDR, parseIdr } from "@/lib/posUtils";
import PosReceiptGiftCardsSection from "@/components/pos/PosReceiptGiftCardsSection";
import PosReceiptPrepaidSection from "@/components/pos/PosReceiptPrepaidSection";

function paymentLabel(method) {
  const m = PAYMENT_METHODS.find((p) => p.v === method);
  return m?.label || method || "—";
}

function customerLabel(sale) {
  if (sale.patient_name_snapshot) return sale.patient_name_snapshot;
  if (sale.customer_name) return sale.customer_name;
  return "Walk-in";
}

export default function PosReceiptDocument({ sale, clinicName = "Clinic" }) {
  if (!sale) return null;

  const when = new Date(sale.paid_at || sale.created_at).toLocaleString();
  const total = Number(sale.total) || 0;
  const amountPaid = Number(sale.amount_paid) || 0;
  const balanceDue = Number(sale.balance_due) || 0;
  const change = Math.max(0, amountPaid - total);
  const items = sale.items || [];

  return (
    <article className="pos-receipt-doc mx-auto w-full max-w-[80mm] sm:max-w-md text-[#2D3A33] text-sm">
      <header className="text-center border-b border-[#2D3A33] pb-4 mb-4">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[#8A9A86]">POS Receipt</p>
        <h1 className="font-display text-xl font-semibold mt-2">{clinicName}</h1>
        <p className="text-xs text-[#5C6C62] mt-2">{when}</p>
      </header>

      <section className="space-y-1 text-sm mb-4">
        <div className="flex justify-between gap-2">
          <span className="text-[#5C6C62]">Sale #</span>
          <span className="font-medium">{sale.sale_number}</span>
        </div>
        {sale.cashier_name_snapshot && (
          <div className="flex justify-between gap-2">
            <span className="text-[#5C6C62]">Cashier</span>
            <span>{sale.cashier_name_snapshot}</span>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <span className="text-[#5C6C62]">Customer</span>
          <span className="font-medium text-right">{customerLabel(sale)}</span>
        </div>
      </section>

      <table className="w-full text-xs mb-4">
        <thead>
          <tr className="border-b border-[#2D3A33] text-[#5C6C62] uppercase tracking-wide">
            <th className="py-1.5 text-left font-semibold">Type</th>
            <th className="py-1.5 text-left font-semibold">Item</th>
            <th className="py-1.5 text-center font-semibold w-8">Qty</th>
            <th className="py-1.5 text-right font-semibold">Unit</th>
            <th className="py-1.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id || `${it.item_type}-${it.name_snapshot}`} className="border-b border-[#EAE6D7]">
              <td className="py-2 pr-1 align-top text-[#5C6C62]">
                {TYPE_LABELS[it.item_type] || it.item_type}
              </td>
              <td className="py-2 pr-1 align-top">
                <div>{it.name_snapshot}</div>
              </td>
              <td className="py-2 text-center align-top">{it.qty}</td>
              <td className="py-2 text-right font-mono align-top whitespace-nowrap">
                {fmtIDR(parseIdr(it.unit_price))}
              </td>
              <td className="py-2 text-right font-mono align-top whitespace-nowrap">
                {fmtIDR(it.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <PosReceiptGiftCardsSection sale={sale} />
      <PosReceiptPrepaidSection sale={sale} />

      <section className="text-sm space-y-1 border-t border-[#2D3A33] pt-3">
        <div className="flex justify-between">
          <span className="text-[#5C6C62]">Subtotal</span>
          <span className="font-mono">{fmtIDR(sale.subtotal)}</span>
        </div>
        {(sale.discount_total || 0) > 0 && (
          <div className="flex justify-between">
            <span className="text-[#5C6C62]">Discount</span>
            <span className="font-mono">− {fmtIDR(sale.discount_total)}</span>
          </div>
        )}
        {(sale.tax_total || 0) > 0 && (
          <div className="flex justify-between">
            <span className="text-[#5C6C62]">Tax</span>
            <span className="font-mono">{fmtIDR(sale.tax_total)}</span>
          </div>
        )}
        <div className="flex justify-between font-display text-lg font-semibold pt-2">
          <span>Total</span>
          <span className="font-mono">{fmtIDR(total)}</span>
        </div>
        {(sale.gift_card_payment_total_idr || 0) > 0 && (
          <div className="flex justify-between">
            <span className="text-[#5C6C62]">Gift card</span>
            <span className="font-mono">{fmtIDR(sale.gift_card_payment_total_idr)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1">
          <span className="text-[#5C6C62]">
            Payment ({paymentLabel(sale.payment_method)}
            {sale.payment_method === "mixed" ? " + other" : ""})
          </span>
          <span className="font-mono">{fmtIDR(amountPaid)}</span>
        </div>
        {balanceDue > 0 && (
          <div className="flex justify-between">
            <span className="text-[#5C6C62]">Balance due</span>
            <span className="font-mono">{fmtIDR(balanceDue)}</span>
          </div>
        )}
        {change > 0 && (
          <div className="flex justify-between">
            <span className="text-[#5C6C62]">Change</span>
            <span className="font-mono">{fmtIDR(change)}</span>
          </div>
        )}
      </section>

      {sale.notes?.trim() && (
        <p className="mt-4 text-xs text-[#5C6C62] border-t border-[#EAE6D7] pt-3">
          <span className="font-semibold text-[#2D3A33]">Notes: </span>
          {sale.notes.trim()}
        </p>
      )}

      <p className="text-center text-[10px] text-[#8A9A86] mt-8">Thank you</p>
    </article>
  );
}
