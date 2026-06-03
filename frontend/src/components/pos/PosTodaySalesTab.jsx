import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import { fmtIDR } from "@/lib/posUtils";
import { Eye, Printer } from "lucide-react";

function SummaryCard({ label, value }) {
  return (
    <div className="bl-card p-3">
      <div className="text-xs text-[#5C6C62]">{label}</div>
      <div className="font-display text-lg mt-1">{value}</div>
    </div>
  );
}

export default function PosTodaySalesTab({ onViewSale, onPrintSale }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/pos/sales/today");
      setData(r.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary;
  const pm = s?.by_payment_method || {};

  return (
    <div className="space-y-4" data-testid="pos-today-sales">
      <div className="flex justify-between items-center">
        <p className="text-sm text-[#5C6C62]">Paid POS sales for {data?.date || "today"} (UTC)</p>
        <button type="button" className="bl-btn-ghost text-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <SummaryCard label="Money collected" value={fmtIDR(s.money_collected_idr ?? s.total_collected_idr)} />
          <SummaryCard label="GC redemptions" value={fmtIDR(s.gift_card_redemptions_idr)} sub="Not cash income" />
          <SummaryCard label="Cash" value={fmtIDR(pm.cash)} />
          <SummaryCard label="Card" value={fmtIDR(pm.card)} />
          <SummaryCard label="QRIS" value={fmtIDR(pm.qris)} />
          <SummaryCard label="Bank transfer" value={fmtIDR(pm.bank_transfer)} />
          <SummaryCard label="Other" value={fmtIDR(pm.other)} />
          <SummaryCard label="Products" value={fmtIDR(s.product_sales_idr)} />
          <SummaryCard label="Packages" value={fmtIDR(s.package_sales_idr)} />
          <SummaryCard label="Gift card sales" value={fmtIDR(s.gift_card_sales_idr)} sub="Issued · cash collected" />
          <SummaryCard label="Service / custom" value={fmtIDR(s.service_custom_sales_idr)} />
        </div>
      )}

      <div className="bl-card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-xs text-[#5C6C62] border-b uppercase tracking-wide">
              <th className="p-3">Sale #</th>
              <th className="p-3">Time</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Items</th>
              <th className="p-3">Payment</th>
              <th className="p-3 text-right">Total</th>
              <th className="p-3">Cashier</th>
              <th className="p-3">Status</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map((row) => (
              <tr key={row.id} className="border-b border-[#EAE6D7] hover:bg-[#F8F5EC]">
                <td className="p-3 font-medium">{row.sale_number}</td>
                <td className="p-3">{row.time_display}</td>
                <td className="p-3">{row.customer_display}</td>
                <td className="p-3 text-[#5C6C62] max-w-[200px] truncate">{row.items_summary}</td>
                <td className="p-3 capitalize">{row.payment_method}</td>
                <td className="p-3 text-right font-mono">{fmtIDR(row.total)}</td>
                <td className="p-3">{row.cashier_name_snapshot || "—"}</td>
                <td className="p-3 capitalize">{row.status}</td>
                <td className="p-3">
                  <div className="flex gap-1">
                    <button type="button" className="p-1.5 rounded hover:bg-[#EDF3EF]" title="View" onClick={() => onViewSale(row.id)}>
                      <Eye className="w-4 h-4" />
                    </button>
                    {row.status === "paid" && (
                      <button type="button" className="p-1.5 rounded hover:bg-[#EDF3EF]" title="Print" onClick={() => onPrintSale(row.id)}>
                        <Printer className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !(data?.items || []).length && (
          <p className="p-6 text-sm text-[#5C6C62] text-center">No paid POS sales today yet.</p>
        )}
      </div>
    </div>
  );
}
