import { useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuth, can } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { Plus, Trash2 } from "lucide-react";

export default function TreatmentItems({ visit, onSaved }) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const CATEGORIES = settings?.form_config?.treatment_categories || [];
  const UNITS = settings?.form_config?.treatment_units || ["session"];
  const editable = can(user, "add_treatment");
  const [form, setForm] = useState({ category: CATEGORIES[0] || "Other", name: "", product_used: "", area_treated: "", quantity: 1, unit_type: UNITS[0] || "session", notes: "", price: 0 });
  const items = visit.treatment_items || [];

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/visits/${visit.id}/treatments`, { ...form, quantity: parseFloat(form.quantity) || 0, price: parseFloat(form.price) || 0 });
      toast.success("Treatment added");
      setForm({ ...form, name: "", product_used: "", area_treated: "", quantity: 1, notes: "", price: 0 });
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const del = async (id) => {
    try { await api.delete(`/visits/${visit.id}/treatments/${id}`); onSaved?.(); } catch {}
  };

  return (
    <div className="space-y-6">
      {editable && (
        <form onSubmit={add} className="bl-card p-5" data-testid="treatment-form">
          <div className="font-display text-base text-[#2D3A33] mb-3">Add treatment item</div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <select className="bl-input" value={form.category} onChange={(e)=>setForm({...form, category: e.target.value})} data-testid="treatment-category">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="bl-input" required placeholder="Treatment name" value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} data-testid="treatment-name" />
            <input className="bl-input" placeholder="Product used" value={form.product_used} onChange={(e)=>setForm({...form, product_used: e.target.value})} data-testid="treatment-product" />
            <input className="bl-input" placeholder="Area treated" value={form.area_treated} onChange={(e)=>setForm({...form, area_treated: e.target.value})} data-testid="treatment-area" />
            <input className="bl-input" type="number" step="0.1" placeholder="Qty" value={form.quantity} onChange={(e)=>setForm({...form, quantity: e.target.value})} data-testid="treatment-qty" />
            <select className="bl-input" value={form.unit_type} onChange={(e)=>setForm({...form, unit_type: e.target.value})} data-testid="treatment-unit">
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input className="bl-input" type="number" step="1000" placeholder="Price (IDR)" value={form.price} onChange={(e)=>setForm({...form, price: e.target.value})} data-testid="treatment-price" />
            <input className="bl-input" placeholder="Notes" value={form.notes} onChange={(e)=>setForm({...form, notes: e.target.value})} />
          </div>
          <button type="submit" className="bl-btn-primary mt-4 inline-flex items-center gap-2" data-testid="treatment-add"><Plus className="w-4 h-4" />Add item</button>
        </form>
      )}

      <div className="bl-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F8F5EC]">
            <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
              <th className="px-5 py-3">Category</th>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Product</th>
              <th className="px-5 py-3">Area</th>
              <th className="px-5 py-3">Qty</th>
              <th className="px-5 py-3 text-right">Price</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-[#5C6C62]">No treatment items added</td></tr>}
            {items.map(it => (
              <tr key={it.id} className="border-t border-[#EAE6D7]" data-testid={`treatment-row-${it.id}`}>
                <td className="px-5 py-3"><span className="bl-chip">{it.category}</span></td>
                <td className="px-5 py-3 font-medium">{it.name}</td>
                <td className="px-5 py-3 text-[#5C6C62]">{it.product_used || "—"}</td>
                <td className="px-5 py-3 text-[#5C6C62]">{it.area_treated || "—"}</td>
                <td className="px-5 py-3">{it.quantity} {it.unit_type}</td>
                <td className="px-5 py-3 text-right">Rp {Number(it.price || 0).toLocaleString("id-ID")}</td>
                <td className="px-5 py-3 text-right">
                  {editable && (
                    <button onClick={()=>del(it.id)} className="text-[#B14A2C] hover:text-[#8a3a22]" data-testid={`treatment-delete-${it.id}`}><Trash2 className="w-4 h-4" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
