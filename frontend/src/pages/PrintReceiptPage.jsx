import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/api";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

export default function PrintReceiptPage() {
  const { vid } = useParams();
  const [visit, setVisit] = useState(null);

  useEffect(() => {
    api.get(`/visits/${vid}`).then(r => setVisit(r.data));
  }, [vid]);

  if (!visit) return <div className="p-10">Loading…</div>;

  const items = visit.treatment_items || [];
  const subtotal = items.reduce((s, it) => s + Number(it.price || 0) * Number(it.quantity || 1), 0);
  const paid = visit.payment_status === "paid";
  const amount = visit.amount_idr ?? subtotal;

  return (
    <div className="min-h-screen bg-white text-[#2D3A33]" style={{ fontFamily: "DM Sans, sans-serif" }}>
      <div className="no-print sticky top-0 bg-[#FDFBF7] border-b border-[#EAE6D7] p-4 flex items-center justify-between">
        <div className="font-display text-lg">Receipt · {visit.patient?.full_name}</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.close()} className="bl-btn-ghost text-sm">Close</button>
          <button type="button" onClick={() => window.print()} className="bl-btn-primary text-sm" data-testid="receipt-print">Print</button>
        </div>
      </div>

      <div className="max-w-md mx-auto p-10 print-page">
        <div className="text-center border-b border-[#2D3A33] pb-4">
          <div className="text-xs uppercase tracking-[0.3em] text-[#8A9A86]">Clinic receipt</div>
          <div className="font-display text-2xl mt-2">Payment receipt</div>
          <div className="text-sm text-[#5C6C62] mt-2">{new Date(visit.paid_at || visit.visit_date || visit.created_at).toLocaleString()}</div>
        </div>

        <div className="mt-6 text-sm space-y-1">
          <div><span className="text-[#5C6C62]">Patient:</span> <strong>{visit.patient?.full_name}</strong></div>
          <div><span className="text-[#5C6C62]">Visit:</span> {visit.id.slice(0, 8)}…</div>
          {visit.booking && <div><span className="text-[#5C6C62]">Appointment:</span> {visit.booking.treatment}</div>}
        </div>

        <table className="w-full mt-6 text-sm">
          <thead>
            <tr className="border-b border-[#2D3A33] text-left text-xs uppercase tracking-wider text-[#5C6C62]">
              <th className="py-2">Item</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className="border-b border-[#EAE6D7]">
                <td className="py-2">{it.name} × {it.quantity}</td>
                <td className="py-2 text-right">{fmtIDR(Number(it.price || 0) * Number(it.quantity || 1))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 pt-3 border-t-2 border-[#2D3A33] flex justify-between font-display text-xl">
          <span>Total</span>
          <span>{fmtIDR(amount)}</span>
        </div>

        <div className="mt-4 text-sm text-[#5C6C62]">
          <div>Method: {visit.payment_method || "—"}</div>
          <div>Status: {paid ? "Paid" : "Unpaid"}</div>
          {visit.payment_notes && <div className="mt-1">Note: {visit.payment_notes}</div>}
        </div>

        <p className="mt-10 text-center text-xs text-[#8A9A86]">Thank you for your visit.</p>
      </div>
    </div>
  );
}
