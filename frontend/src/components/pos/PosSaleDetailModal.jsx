import { useEffect, useState } from "react";
import api from "@/lib/api";
import { X, Printer } from "lucide-react";
import { fmtIDR, PAYMENT_METHODS, TYPE_LABELS, parseIdr } from "@/lib/posUtils";
import PosItemTypeBadge from "@/components/pos/PosItemTypeBadge";

function paymentLabel(method) {
  return PAYMENT_METHODS.find((p) => p.v === method)?.label || method || "—";
}

export default function PosSaleDetailModal({ saleId, clinicName, onClose, onPrint, canCancel, canRefund, onCancelled }) {
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!saleId) return undefined;
    setLoading(true);
    api
      .get(`/pos/sales/${saleId}`)
      .then((r) => setSale(r.data))
      .catch(() => setSale(null))
      .finally(() => setLoading(false));
    return undefined;
  }, [saleId]);

  if (!saleId) return null;

  const total = Number(sale?.total) || 0;
  const paid = Number(sale?.amount_paid) || 0;
  const change = Math.max(0, paid - total);

  const handleCancel = async () => {
    const reason = window.prompt("Cancellation reason (required, min 3 characters):");
    if (!reason || reason.trim().length < 3) {
      window.alert("A cancellation reason is required.");
      return;
    }
    if (!window.confirm("Cancel this sale? Stock and unused packages/gift cards will be reversed.")) return;
    setBusy(true);
    try {
      await api.post(`/pos/sales/${saleId}/cancel`, { cancel_reason: reason.trim() });
      onCancelled?.();
      onClose();
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Could not cancel");
    } finally {
      setBusy(false);
    }
  };

  const handleRefund = async () => {
    const amountStr = window.prompt(`Refund amount (IDR, max ${total}):`, String(total));
    if (!amountStr) return;
    const amount = parseInt(String(amountStr).replace(/\D/g, ""), 10);
    if (!amount || amount <= 0) return;
    const reason = window.prompt("Refund reason (required):");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await api.post(`/pos/sales/${saleId}/refund`, {
        amount_idr: amount,
        method: sale?.payment_method || "cash",
        reason: reason.trim(),
      });
      window.alert("Refund recorded");
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Could not record refund");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
        data-testid="pos-sale-detail-modal"
      >
        <div className="flex justify-between items-start gap-3 mb-4">
          <div>
            <div className="label-eyebrow">POS sale</div>
            <h2 className="font-display text-xl">{sale?.sale_number || "…"}</h2>
            {sale && (
              <p className="text-sm text-[#5C6C62] mt-1">
                {new Date(sale.paid_at || sale.created_at).toLocaleString()}
                {" · "}
                <span className="capitalize">{sale.status}</span>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
        {!loading && !sale && <p className="text-sm text-[#B14A2C]">Sale not found</p>}

        {sale && (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div>
                <span className="text-[#5C6C62]">Customer</span>
                <p className="font-medium">
                  {sale.patient_name_snapshot || sale.customer_name || (sale.is_walk_in ? "Walk-in" : "—")}
                </p>
              </div>
              <div>
                <span className="text-[#5C6C62]">Cashier</span>
                <p>{sale.cashier_name_snapshot || "—"}</p>
              </div>
            </div>

            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="text-left text-xs text-[#5C6C62] border-b">
                  <th className="py-2">Type</th>
                  <th className="py-2">Item</th>
                  <th className="py-2 text-center">Qty</th>
                  <th className="py-2 text-right">Unit</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(sale.items || []).map((it) => (
                  <tr key={it.id} className="border-b border-[#EAE6D7]">
                    <td className="py-2 pr-1">
                      <PosItemTypeBadge type={it.item_type} />
                    </td>
                    <td className="py-2">
                      <div>{it.name_snapshot}</div>
                      {it.item_type === "gift_card" && it.gift_card_code && (
                        <div className="text-xs font-mono text-[#5C6C62]">Code: {it.gift_card_code}</div>
                      )}
                    </td>
                    <td className="py-2 text-center">{it.qty}</td>
                    <td className="py-2 text-right font-mono">{fmtIDR(parseIdr(it.unit_price))}</td>
                    <td className="py-2 text-right font-mono">{fmtIDR(it.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-sm space-y-1 border-t pt-3">
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
              <div className="flex justify-between font-semibold text-base pt-1">
                <span>Total</span>
                <span className="font-mono">{fmtIDR(sale.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5C6C62]">Paid ({paymentLabel(sale.payment_method)})</span>
                <span className="font-mono">{fmtIDR(sale.amount_paid)}</span>
              </div>
              {(sale.balance_due || 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-[#5C6C62]">Balance due</span>
                  <span className="font-mono">{fmtIDR(sale.balance_due)}</span>
                </div>
              )}
              {change > 0 && (
                <div className="flex justify-between">
                  <span className="text-[#5C6C62]">Change</span>
                  <span className="font-mono">{fmtIDR(change)}</span>
                </div>
              )}
            </div>

            {sale.cancel_reason?.trim() && (
              <p className="mt-3 text-sm text-[#B14A2C]">
                <span className="font-medium">Cancelled: </span>
                {sale.cancel_reason}
              </p>
            )}

            {(sale.refunds || []).length > 0 && (
              <div className="mt-4 border-t pt-3">
                <div className="label-eyebrow mb-2">Refunds / adjustments</div>
                <ul className="text-sm space-y-1">
                  {sale.refunds.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span className="text-[#5C6C62]">{r.reason}</span>
                      <span className="font-mono">{fmtIDR(r.amount_idr)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-6">
              {sale.status === "paid" && (
                <button
                  type="button"
                  className="bl-btn-primary text-sm inline-flex items-center gap-1.5"
                  onClick={() => onPrint?.(sale)}
                >
                  <Printer className="w-4 h-4" /> Print receipt
                </button>
              )}
              {canCancel && sale.status !== "cancelled" && !sale.closing_locked && (
                <button type="button" className="bl-btn-ghost text-sm text-[#B14A2C]" disabled={busy} onClick={handleCancel}>
                  Cancel sale
                </button>
              )}
              {canRefund && sale.status === "paid" && (
                <button type="button" className="bl-btn-ghost text-sm" disabled={busy} onClick={handleRefund} data-testid="pos-refund-sale">
                  Record refund
                </button>
              )}
              {sale.closing_locked && (
                <p className="text-xs text-[#B45309] w-full">
                  Day is closed — reopen the closing or record a refund/adjustment instead of cancelling.
                </p>
              )}
              <button type="button" className="bl-btn-ghost text-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
