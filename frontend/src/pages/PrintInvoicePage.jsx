import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/api";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

export default function PrintInvoicePage() {
  const { id } = useParams();
  const [inv, setInv] = useState(null);

  useEffect(() => {
    api.get(`/invoices/${id}`).then((r) => setInv(r.data));
  }, [id]);

  if (!inv) return <div className="p-10">Loading…</div>;

  return (
    <div className="min-h-screen bg-white text-[#2D3A33]" style={{ fontFamily: "DM Sans, sans-serif" }}>
      <div className="no-print sticky top-0 bg-[#FDFBF7] border-b border-[#EAE6D7] p-4 flex items-center justify-between">
        <div className="font-display text-lg">{inv.invoice_number}</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.close()} className="bl-btn-ghost text-sm">Close</button>
          <button type="button" onClick={() => window.print()} className="bl-btn-primary text-sm">Print</button>
        </div>
      </div>

      <div className="max-w-md mx-auto p-10 print-page">
        <div className="text-center border-b border-[#2D3A33] pb-4">
          <div className="text-xs uppercase tracking-[0.3em] text-[#8A9A86]">Tax invoice</div>
          <div className="font-display text-2xl mt-2">{inv.invoice_number}</div>
          <div className="text-sm text-[#5C6C62] mt-2">{new Date(inv.created_at).toLocaleString()}</div>
        </div>

        <div className="mt-6 text-sm space-y-1">
          <div><span className="text-[#5C6C62]">Patient:</span> <strong>{inv.patient?.full_name}</strong></div>
          <div><span className="text-[#5C6C62]">Status:</span> {inv.payment_status}</div>
        </div>

        <table className="w-full mt-6 text-sm">
          <thead>
            <tr className="border-b border-[#2D3A33] text-left text-xs uppercase tracking-wider text-[#5C6C62]">
              <th className="py-2">Item</th>
              <th className="py-2">Performer</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(inv.items || []).map((it) => {
              const serviceVal = it.original_treatment_value != null
                ? Number(it.original_treatment_value)
                : Number(it.unit_price_idr || 0) * Number(it.quantity || 1);
              const due = it.paid_by === "package"
                ? 0
                : (it.amount_charged != null ? Number(it.amount_charged) : serviceVal);
              return (
              <tr key={it.id} className="border-b border-[#EAE6D7]">
                <td className="py-2">
                  {it.name} × {it.quantity}
                  {it.paid_by === "package" && (
                    <div className="text-xs text-[#5C8A6E] mt-0.5">Paid by Package · service value {fmtIDR(serviceVal)}</div>
                  )}
                </td>
                <td className="py-2 text-sm text-[#5C6C62]">
                  {it.performer_name_snapshot
                    ? `${it.performer_name_snapshot} (${it.performer_role_snapshot || "staff"})`
                    : "—"}
                </td>
                <td className="py-2 text-right">
                  {it.paid_by === "package" ? (
                    <span><span className="line-through text-[#8A9A86] text-xs mr-1">{fmtIDR(serviceVal)}</span>{fmtIDR(0)}</span>
                  ) : (
                    fmtIDR(due)
                  )}
                </td>
              </tr>
            );})}
          </tbody>
        </table>

        <div className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{fmtIDR(inv.subtotal)}</span></div>
          {inv.package_covered_value > 0 && (
            <div className="flex justify-between text-[#5C6C62]">
              <span>Covered by package</span>
              <span>{fmtIDR(inv.package_covered_value)}</span>
            </div>
          )}
          {inv.discount_amount > 0 && (
            <div className="flex justify-between text-[#B14A2C]"><span>Discount</span><span>−{fmtIDR(inv.discount_amount)}</span></div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t-2 border-[#2D3A33] flex justify-between font-display text-xl">
          <span>Total</span>
          <span>{fmtIDR(inv.total_amount)}</span>
        </div>

        <div className="mt-4 text-sm text-[#5C6C62] space-y-1">
          <div>Paid: {fmtIDR(inv.amount_paid)}</div>
          <div>Balance: {fmtIDR(inv.remaining_balance)}</div>
          <div>Method: {inv.payment_method || "—"}</div>
          {inv.payment_reference && <div>Ref: {inv.payment_reference}</div>}
          {inv.discount_reason && <div>Discount: {inv.discount_reason}</div>}
          {inv.notes && <div>Note: {inv.notes}</div>}
        </div>

        <p className="mt-10 text-center text-xs text-[#8A9A86]">Thank you for your visit.</p>
      </div>
    </div>
  );
}
