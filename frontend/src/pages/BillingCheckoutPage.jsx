import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useClinic, formatIdr } from "@/lib/clinic";
import api from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import { Copy, CheckCircle2, MessageCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function BillingCheckoutPage() {
  const { plans, clinic } = useClinic();
  const [params] = useSearchParams();
  const planKey = params.get("plan") || "clinic";
  const plan = plans.find(p => p.key === planKey) || plans[0];
  const uniq = useMemo(() => Math.floor(Math.random() * 900) + 100, []);
  const total = plan ? plan.price_idr + uniq : 0;
  const [submitted, setSubmitted] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState({ whatsapp: "", hours: "" });
  const [banks, setBanks] = useState([]);

  useEffect(() => {
    api.get("/platform/public-config").then(r => {
      setSupport(r.data?.support || {});
      setBanks(r.data?.banks || []);
    }).catch(() => {});
  }, []);

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

  // Pre-filled WhatsApp message
  const waMessage = `Hi ClinicOS! I just submitted payment for the ${plan.name} plan from ${clinic?.name || "my clinic"}.

Total: ${formatIdr(total)}
Unique code: ${uniq}
Plan: ${plan.name}

Please verify and activate. Thank you!`;

  const waLink = support.whatsapp ? `https://wa.me/${support.whatsapp}?text=${encodeURIComponent(waMessage)}` : "";

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto" data-testid="checkout-page">
      <Link to="/billing/plans" className="text-sm text-[#5C6C62]">← Back to plans</Link>
      <div className="label-eyebrow mt-4">Checkout · {plan.name} plan</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Transfer instructions</h1>

      <div className="mt-6 bl-card p-5" data-testid="bank-info">
        <div className="label-eyebrow mb-3">Bank accounts</div>
        {banks.length === 0 ? (
          <div className="text-sm text-[#5C6C62] py-3">No bank accounts available right now. Please contact support.</div>
        ) : banks.map((b) => (
          <div key={b.id || b.bank} className="flex items-center justify-between py-3 border-t border-[#EAE6D7] first:border-t-0">
            <div>
              <div className="font-medium text-[#2D3A33]">{b.bank}</div>
              <div className="text-sm text-[#5C6C62]">{b.account_holder}</div>
            </div>
            <button onClick={()=>copy(b.account_number)} className="inline-flex items-center gap-2 font-mono text-[#2D3A33] hover:text-[#5C6C62]" data-testid={`bank-${b.bank.toLowerCase()}`}>
              {b.account_number} <Copy className="w-3.5 h-3.5" />
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

      {/* ---- Magic Link: WhatsApp notify support to fast-track verification ---- */}
      {support.whatsapp && (
        <div className="mt-5 p-5 rounded-2xl relative overflow-hidden" style={{ background: "linear-gradient(135deg, #2D3A33 0%, #3F5A52 100%)", color: "white" }} data-testid="magic-link-card">
          <div className="absolute -top-6 -right-6 opacity-20">
            <Sparkles className="w-32 h-32" />
          </div>
          <div className="relative">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4" />
              <div className="text-xs uppercase tracking-widest" style={{ color: "#D4A373" }}>Fast-track activation</div>
            </div>
            <h3 className="font-display text-2xl mt-1">Notify us in 1 click.</h3>
            <p className="text-sm mt-2 max-w-md" style={{ color: "#E6E8E6" }}>
              Already transferred? Ping us on WhatsApp with the payment details pre-filled — we'll typically verify and activate within minutes during business hours ({support.hours || "Mon-Fri"}).
            </p>

            <div className="mt-5 flex items-center gap-6 flex-wrap">
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-medium text-sm"
                style={{ background: "#25D366", color: "white" }}
                data-testid="magic-wa-link"
              >
                <MessageCircle className="w-4 h-4" /> Open WhatsApp with details
              </a>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ background: "white" }} data-testid="magic-qr-code">
                  <QRCodeSVG value={waLink} size={84} bgColor="#FFFFFF" fgColor="#2D3A33" level="M" includeMargin={false} />
                </div>
                <div className="text-xs" style={{ color: "#C7D1CB" }}>
                  Or scan with your<br />phone camera
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t" style={{ borderColor: "rgba(255,255,255,0.15)" }}>
              <div className="text-xs" style={{ color: "#C7D1CB" }}>Support WhatsApp: <span className="font-mono">+{support.whatsapp}</span> · <button onClick={() => copy(`+${support.whatsapp}`)} className="underline" data-testid="magic-copy-number">copy</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
