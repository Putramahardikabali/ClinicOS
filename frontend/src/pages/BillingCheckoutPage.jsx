import { useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useClinic, formatIdr } from "@/lib/clinic";
import api from "@/lib/api";
import { Copy, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function BillingCheckoutPage() {
  const { plans } = useClinic();
  const [params] = useSearchParams();
  const planKey = params.get("plan") || "clinic";
  const plan = plans.find(p => p.key === planKey) || plans[0];
  const uniq = useMemo(() => Math.floor(Math.random() * 900) + 100, []);
  const total = plan ? plan.price_idr + uniq : 0;
  const [submitted, setSubmitted] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const copy = (text) => { navigator.clipboard.writeText(text); toast.success("Copied"); };

  const submit = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("plan", plan.key);
      fd.append("amount", String(total));
      fd.append("unique_code", String(uniq));
      if (file) fd.append("file", file);
      await api.post("/billing/payment-request", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setSubmitted(true);
      toast.success("Payment submitted — we'll verify shortly");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed");
    } finally { setBusy(false); }
  };

  if (!plan) return <div className="p-10 text-[#5C6C62]">Loading…</div>;

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto" data-testid="checkout-page">
      <Link to="/billing/plans" className="text-sm text-[#5C6C62]">← Back to plans</Link>
      <div className="label-eyebrow mt-4">Checkout · {plan.name} plan</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Transfer instructions</h1>

      <div className="mt-6 bl-card p-5" data-testid="bank-info">
        <div className="label-eyebrow mb-3">Bank accounts</div>
        {[
          { bank: "BCA", number: "1234567890" },
          { bank: "Mandiri", number: "0987654321" },
        ].map((b) => (
          <div key={b.bank} className="flex items-center justify-between py-3 border-t border-[#EAE6D7] first:border-t-0">
            <div>
              <div className="font-medium text-[#2D3A33]">{b.bank}</div>
              <div className="text-sm text-[#5C6C62]">PT ClinicOS Indonesia</div>
            </div>
            <button onClick={()=>copy(b.number)} className="inline-flex items-center gap-2 font-mono text-[#2D3A33] hover:text-[#5C6C62]">
              {b.number} <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 bl-card p-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><div className="label-eyebrow">Plan</div><div className="mt-1 font-medium">{plan.name}</div></div>
          <div><div className="label-eyebrow">Plan price</div><div className="mt-1 font-medium">{formatIdr(plan.price_idr)}</div></div>
          <div><div className="label-eyebrow">Unique code</div><div className="mt-1 font-medium font-mono">{uniq}</div></div>
          <div><div className="label-eyebrow">Total to transfer</div><div className="mt-1 font-display text-2xl text-[#2D3A33]" data-testid="checkout-total">{formatIdr(total)}</div></div>
        </div>
        <p className="mt-4 text-xs text-[#5C6C62]">Please transfer the <strong>exact total amount including the unique code</strong> so we can match your payment automatically.</p>
      </div>

      <div className="mt-5 bl-card p-5">
        <div className="label-eyebrow mb-2">Upload payment proof</div>
        {submitted ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "#52796F" }} data-testid="checkout-success">
            <CheckCircle2 className="w-4 h-4" /> Submitted — activation within 1×24 hours.
          </div>
        ) : (
          <>
            <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} className="block text-sm" data-testid="proof-input" />
            <p className="text-xs text-[#5C6C62] mt-2">Upload the screenshot or PDF receipt of your bank transfer. PNG, JPG, or PDF.</p>
            <button onClick={submit} disabled={busy} className="bl-btn-primary mt-4 w-full sm:w-auto disabled:opacity-50" data-testid="payment-submit">{busy ? "Submitting…" : "Submit payment"}</button>
          </>
        )}
      </div>
    </div>
  );
}
