import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { Plus, Trash2 } from "lucide-react";

export default function Billing({ visit, onSaved }) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const PAYMENT_METHODS = settings?.form_config?.payment_methods || ["Cash"];
  const editable = can(user, "process_billing");
  const [items, setItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("unpaid");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (visit.billing) {
      setItems(visit.billing.items || []);
      setDiscount(visit.billing.discount || 0);
      setPaymentMethod(visit.billing.payment_method || "");
      setPaymentStatus(visit.billing.payment_status || "unpaid");
      setNotes(visit.billing.notes || "");
    } else {
      // pre-fill from treatment_items
      const pre = (visit.treatment_items || []).map(t => ({ name: `${t.name}${t.product_used ? " · " + t.product_used : ""}`, qty: t.quantity, price: t.price || 0, discount: 0 }));
      setItems(pre);
    }
  }, [visit.id]);

  const updateItem = (idx, field, val) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: field === "name" ? val : Number(val) } : it));
  };

  const addRow = () => setItems((p) => [...p, { name: "", qty: 1, price: 0, discount: 0 }]);
  const removeRow = (i) => setItems((p) => p.filter((_, idx) => idx !== i));

  const subtotal = items.reduce((s, it) => s + ((Number(it.qty) || 0) * (Number(it.price) || 0) - (Number(it.discount) || 0)), 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));

  const save = async () => {
    try {
      await api.put(`/visits/${visit.id}/billing`, {
        items, discount: Number(discount) || 0, payment_method: paymentMethod, payment_status: paymentStatus, notes,
      });
      toast.success("Billing saved");
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const fmt = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

  return (
    <div className="space-y-6">
      <div className="bl-card p-5" data-testid="billing-section">
        <div className="flex items-center justify-between mb-3">
          <div className="font-display text-lg text-[#2D3A33]">Invoice items</div>
          {editable && <button onClick={addRow} className="bl-btn-ghost text-sm inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add line</button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F8F5EC]">
              <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 w-20">Qty</th>
                <th className="px-3 py-2 w-32">Unit price</th>
                <th className="px-3 py-2 w-32">Line discount</th>
                <th className="px-3 py-2 w-32 text-right">Total</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && <tr><td colSpan={6} className="text-center py-6 text-[#5C6C62]">No invoice items</td></tr>}
              {items.map((it, i) => (
                <tr key={i} className="border-t border-[#EAE6D7]">
                  <td className="px-3 py-2"><input disabled={!editable} className="bl-input py-2" value={it.name} onChange={(e)=>updateItem(i,"name",e.target.value)} data-testid={`bill-name-${i}`} /></td>
                  <td className="px-3 py-2"><input disabled={!editable} type="number" className="bl-input py-2" value={it.qty} onChange={(e)=>updateItem(i,"qty",e.target.value)} data-testid={`bill-qty-${i}`} /></td>
                  <td className="px-3 py-2"><input disabled={!editable} type="number" className="bl-input py-2" value={it.price} onChange={(e)=>updateItem(i,"price",e.target.value)} data-testid={`bill-price-${i}`} /></td>
                  <td className="px-3 py-2"><input disabled={!editable} type="number" className="bl-input py-2" value={it.discount} onChange={(e)=>updateItem(i,"discount",e.target.value)} /></td>
                  <td className="px-3 py-2 text-right font-medium">{fmt((Number(it.qty)||0)*(Number(it.price)||0) - (Number(it.discount)||0))}</td>
                  <td className="px-3 py-2 text-right">{editable && <button onClick={()=>removeRow(i)} className="text-[#B14A2C]"><Trash2 className="w-4 h-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-eyebrow block mb-2">Payment method</label>
              <select disabled={!editable} className="bl-input" value={paymentMethod} onChange={(e)=>setPaymentMethod(e.target.value)} data-testid="bill-method">
                <option value="">— Select —</option>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-2">Payment status</label>
              <select disabled={!editable} className="bl-input" value={paymentStatus} onChange={(e)=>setPaymentStatus(e.target.value)} data-testid="bill-status">
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label-eyebrow block mb-2">Notes</label>
            <textarea disabled={!editable} className="bl-input min-h-[80px]" value={notes} onChange={(e)=>setNotes(e.target.value)} data-testid="bill-notes" />
          </div>
        </div>

        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Summary</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-[#5C6C62]">Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#5C6C62]">Overall discount</span>
              <input disabled={!editable} type="number" className="bl-input w-32 py-1.5 text-right" value={discount} onChange={(e)=>setDiscount(e.target.value)} data-testid="bill-discount" />
            </div>
            <div className="border-t border-[#EAE6D7] mt-2 pt-2 flex justify-between font-display text-2xl text-[#2D3A33]">
              <span>Total</span><span data-testid="bill-total">{fmt(total)}</span>
            </div>
          </div>
          {editable && (
            <button onClick={save} className="bl-btn-primary w-full mt-5" data-testid="bill-save">Save invoice</button>
          )}
        </div>
      </div>
    </div>
  );
}
