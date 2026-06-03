import { giftCardRedemptionIdr, INCOME_PAYMENT_METHOD_KEYS } from "@/lib/closingGiftCards";
import { fmtIDR } from "@/lib/posUtils";

const METHOD_LABELS = {
  cash: "Cash",
  card: "Card",
  qris: "QRIS",
  bank_transfer: "Bank transfer",
  other: "Other",
};

function Row({ label, value, bold }) {
  return (
    <div className={`flex justify-between text-sm py-0.5 ${bold ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

export default function ClosingReportDocument({ closing, clinicName }) {
  const snap = closing?.snapshot || closing || {};
  const pm = snap.payment_methods || {};
  const bd = snap.breakdown || {};
  const pos = snap.pos || {};
  const inv = snap.invoices || {};
  const txs = snap.transactions || [];

  return (
    <div className="closing-report-document p-8 text-[#2D3A33] bg-white max-w-[800px] mx-auto text-sm">
      <div className="text-center border-b border-[#2D3A33] pb-4 mb-6">
        <div className="text-xs uppercase tracking-[0.25em] text-[#8A9A86]">Daily sales closing</div>
        <div className="font-display text-2xl mt-2">{clinicName || "Clinic"}</div>
        <div className="mt-2">{closing?.business_date || snap.date}</div>
        {closing?.closed_at && (
          <div className="text-xs text-[#5C6C62] mt-1">
            Closed {new Date(closing.closed_at).toLocaleString()}
            {closing.closed_by_name_snapshot ? ` · ${closing.closed_by_name_snapshot}` : ""}
          </div>
        )}
      </div>

      <Row label="Money collected" value={fmtIDR(snap.money_collected_idr ?? snap.total_collected_idr)} bold />
      <Row label="Gift card redemptions" value={fmtIDR(snap.gift_card_redemptions_idr)} />
      <Row label="Outstanding gift card liability" value={fmtIDR(snap.outstanding_gift_card_liability_idr)} />

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs uppercase text-[#5C6C62] mb-2">Sales breakdown</div>
          <Row label="Product sales" value={fmtIDR(bd.product_sales_idr)} />
          <Row label="Package sales" value={fmtIDR(bd.package_sales_idr)} />
          <Row label="Service sales" value={fmtIDR(bd.service_sales_idr)} />
          <Row label="Custom sales" value={fmtIDR(bd.custom_sales_idr)} />
          <Row label="Gift card sales (issued)" value={fmtIDR(bd.gift_card_sales_idr)} />
          <Row label="Sales paid with gift card" value={fmtIDR(bd.gift_card_redemption_settled_idr)} />
          <Row label="Gift card redemptions" value={fmtIDR(bd.gift_card_redemptions_idr)} />
          <Row label="Treatment invoices" value={fmtIDR(bd.treatment_invoice_payments_idr)} />
        </div>
        <div>
          <div className="text-xs uppercase text-[#5C6C62] mb-2">Income (money collected)</div>
          {INCOME_PAYMENT_METHOD_KEYS.map((k) =>
            (pm[k] || 0) > 0 ? <Row key={k} label={METHOD_LABELS[k] || k} value={fmtIDR(pm[k])} /> : null,
          )}
          {giftCardRedemptionIdr(snap) > 0 && (
            <Row label="Gift card redemptions" value={fmtIDR(giftCardRedemptionIdr(snap))} />
          )}
          <div className="text-xs uppercase text-[#5C6C62] mb-2 mt-4">Cash reconciliation</div>
          <Row label="Expected cash" value={fmtIDR(closing?.expected_cash_idr ?? snap.expected_cash_idr)} />
          <Row label="Actual counted" value={fmtIDR(closing?.actual_cash_counted_idr)} />
          <Row
            label="Difference"
            value={
              closing?.cash_difference_idr != null
                ? fmtIDR(closing.cash_difference_idr)
                : "—"
            }
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="uppercase text-[#5C6C62] mb-1">POS</div>
          <Row label="Transactions" value={String(pos.transaction_count || 0)} />
          <Row label="Money collected" value={fmtIDR(pos.money_collected_idr ?? pos.total_collected_idr)} />
        </div>
        <div>
          <div className="uppercase text-[#5C6C62] mb-1">Invoices</div>
          <Row label="Transactions" value={String(inv.transaction_count || 0)} />
          <Row label="Money collected" value={fmtIDR(inv.money_collected_idr ?? inv.total_collected_idr)} />
        </div>
      </div>

      {closing?.notes && (
        <div className="mt-4 p-3 border border-[#EAE6D7] rounded-lg">
          <div className="text-xs uppercase text-[#5C6C62]">Notes</div>
          <p className="mt-1 whitespace-pre-wrap">{closing.notes}</p>
        </div>
      )}

      <table className="w-full mt-6 text-xs">
        <thead>
          <tr className="border-b border-[#2D3A33] text-left">
            <th className="py-2">Type</th>
            <th className="py-2">Ref</th>
            <th className="py-2">Customer</th>
            <th className="py-2 text-right">Cash/card</th>
            <th className="py-2 text-right">GC redeem</th>
          </tr>
        </thead>
        <tbody>
          {txs.map((tx) => (
            <tr key={`${tx.source}-${tx.id}`} className="border-b border-[#EAE6D7]">
              <td className="py-1.5 capitalize">{tx.source}</td>
              <td className="py-1.5">{tx.reference}</td>
              <td className="py-1.5">{tx.customer_display}</td>
              <td className="py-1.5 text-right font-mono">{fmtIDR(tx.money_collected_idr ?? tx.amount_idr)}</td>
              <td className="py-1.5 text-right font-mono">{fmtIDR(tx.gift_card_redemption_idr || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
