import { useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useClinic, formatIdr } from "@/lib/clinic";
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

  const copy = (text) => { navigator.clipboard.writeText(text); toast.success("Copied"); };

  if (!plan) return <div className="p-10 text-[#5C6C62]">Loading…</div>;

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto" data-testid="checkout-page">
      <Link to="/billing/plans" className="text-sm text-[#5C6C62]">← Back to plans</Link>
      <div className="label-eyebrow mt-4">Checkout · {plan.name} plan</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Transfer instructions</h1>

      <div className="mt-6 bl-card p-5">
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
          <div>
            <div className="label-eyebrow">Plan</div>
            <div className="mt-1 font-medium">{plan.name}</div>
          </div>
          <div>
            <div className="label-eyebrow">Plan price</div>
            <div className="mt-1 font-medium">{formatIdr(plan.price_idr)}</div>
          </div>
          <div>
            <div className="label-eyebrow">Unique code</div>
            <div className="mt-1 font-medium font-mono">{uniq}</div>
          </div>
          <div>
            <div className="label-eyebrow">Total to transfer</div>
            <div className="mt-1 font-display text-2xl text-[#2D3A33]" data-testid="checkout-total">{formatIdr(total)}</div>
          </div>
        </div>
        <p className="mt-4 text-xs text-[#5C6C62]">Please transfer the <strong>exact total amount including the unique code</strong> so we can match your payment automatically.</p>
      </div>

      <div className="mt-5 bl-card p-5">
        <div className="label-eyebrow mb-2">Upload payment proof</div>
        {submitted ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "#52796F" }}>
            <CheckCircle2 className="w-4 h-4" /> Submitted — activation within 1×24 hours.
          </div>
        ) : (
          <>
            <input type="file" accept="image/*" className="block text-sm" data-testid="proof-input" />
            <button onClick={() => { setSubmitted(true); toast.success("Proof submitted — we'll verify shortly"); }} className="bl-btn-primary mt-4 w-full sm:w-auto" data-testid="proof-submit">Submit proof</button>
            <p className="text-xs text-[#5C6C62] mt-2">For the MVP, payment proof storage isn't wired up yet — but a Super Admin will manually verify and activate your plan.</p>
          </>
        )}
      </div>
    </div>
  );
}
