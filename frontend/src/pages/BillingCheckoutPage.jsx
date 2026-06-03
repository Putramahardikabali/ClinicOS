import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useClinic, formatIdr } from "@/lib/clinic";
import api from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check, CheckCircle2, MessageCircle, Upload, FileText } from "lucide-react";
import { toast } from "sonner";
import { computePlanCharge, cycleLabel } from "@/lib/billing";
import { useAuth, canSubscribeBilling, canViewSaasBilling } from "@/lib/auth";

const ACTION_LABELS = {
  renew: "Renew",
  upgrade: "Upgrade",
  subscribe: "Subscribe",
};

function StepHeader({ step, title }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="w-7 h-7 rounded-full bg-[#EDF3EF] text-[#52796F] text-sm font-semibold flex items-center justify-center shrink-0">
        {step}
      </span>
      <h2 className="font-display text-lg text-[#2D3A33]">{title}</h2>
    </div>
  );
}

export default function BillingCheckoutPage() {
  const { plans, clinic } = useClinic();
  const { user } = useAuth();
  const canSubscribe = canSubscribeBilling(user);
  const canViewSaas = canViewSaasBilling(user);
  const [params] = useSearchParams();
  const planKey = params.get("plan") || "clinic";
  const cycleKey = params.get("cycle") || "monthly";
  const action = params.get("action") || "subscribe";
  const plan = plans.find((p) => p.key === planKey) || plans[0];
  const charge = useMemo(
    () => (plan ? computePlanCharge(plan.price_idr, cycleKey) : null),
    [plan, cycleKey],
  );
  const uniq = useMemo(() => Math.floor(Math.random() * 900) + 100, []);
  const total = charge ? charge.totalIdr + uniq : 0;
  const [submitted, setSubmitted] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState({ whatsapp: "", hours: "" });
  const [banks, setBanks] = useState([]);
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    api
      .get("/platform/public-config")
      .then((r) => {
        setSupport(r.data?.support || {});
        setBanks(r.data?.banks || []);
      })
      .catch(() => {});
  }, []);

  const copy = (text, key) => {
    navigator.clipboard.writeText(text);
    if (key) {
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } else {
      toast.success("Copied");
    }
  };

  const submit = async () => {
    if (!plan || !charge) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("plan", plan.key);
      fd.append("billing_cycle", cycleKey);
      fd.append("amount", String(total));
      fd.append("unique_code", String(uniq));
      if (file) fd.append("file", file);
      await api.post("/billing/payment-request", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSubmitted(true);
      toast.success("Payment proof submitted — we'll verify shortly");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  if (!canViewSaas || !canSubscribe) {
    return <Navigate to="/billing/plans" replace />;
  }

  if (!plan || !charge) return <div className="p-10 text-[#5C6C62]">Loading…</div>;

  const actionLabel = ACTION_LABELS[action] || "Subscribe";
  const waMessage = `Hi ClinicOS! I just submitted payment to ${actionLabel.toLowerCase()} to the ${plan.name} plan (${charge.label}) from ${clinic?.name || "my clinic"}.

Total: ${formatIdr(total)}
Unique code: ${uniq}
Plan: ${plan.name}
Billing: ${charge.label}

Please verify and activate. Thank you!`;

  const waLink = support.whatsapp
    ? `https://wa.me/${support.whatsapp}?text=${encodeURIComponent(waMessage)}`
    : "";

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-3xl mx-auto" data-testid="checkout-page">
      <Link to="/billing/plans" className="text-sm text-[#5C6C62] hover:text-[#2D3A33]">
        ← Back to plans
      </Link>
      <div className="label-eyebrow mt-4">
        Checkout · {actionLabel} · {plan.name}
      </div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">
        Transfer instructions
      </h1>
      <p className="mt-2 text-sm text-[#5C6C62]">
        Billing period: <strong className="text-[#2D3A33]">{charge.label}</strong> ({charge.months} month
        {charge.months !== 1 ? "s" : ""})
      </p>

      {/* Step 1: Transfer exact amount */}
      <div className="mt-6 bl-card p-5 sm:p-6">
        <StepHeader step={1} title="Transfer exact amount" />

        <div className="rounded-xl p-5 sm:p-6 text-center" style={{ background: "#F8F5EC" }}>
          <div className="text-xs uppercase tracking-widest text-[#5C6C62]">Total to transfer</div>
          <div
            className="font-display text-3xl sm:text-4xl text-[#2D3A33] mt-1"
            data-testid="checkout-total"
          >
            {formatIdr(total)}
          </div>
          <p className="text-sm text-[#5C6C62] mt-2 max-w-md mx-auto">
            Please transfer the exact amount including the unique code.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="label-eyebrow">Plan</div>
            <div className="mt-1 font-medium text-[#2D3A33]">{plan.name}</div>
          </div>
          <div>
            <div className="label-eyebrow">Billing period</div>
            <div className="mt-1 font-medium text-[#2D3A33]">{cycleLabel(cycleKey)}</div>
          </div>
          <div>
            <div className="label-eyebrow">Subtotal</div>
            <div className="mt-1 font-medium text-[#2D3A33]">{formatIdr(charge.totalIdr)}</div>
            {charge.months > 1 && (
              <div className="text-xs text-[#5C6C62]">
                {formatIdr(charge.perMonthIdr)}/mo × {charge.months}
              </div>
            )}
          </div>
          <div>
            <div className="label-eyebrow">Unique transfer code</div>
            <div className="mt-1 font-medium font-mono text-[#52796F]">+ {formatIdr(uniq)}</div>
            <p className="text-xs text-[#5C6C62] mt-1">
              This code helps us match your payment automatically.
            </p>
          </div>
        </div>
      </div>

      {/* Step 2: Choose bank account */}
      <div className="mt-5 bl-card p-5 sm:p-6" data-testid="bank-info">
        <StepHeader step={2} title="Choose bank account" />
        {banks.length === 0 ? (
          <div className="text-sm text-[#5C6C62] py-3">
            No bank accounts available right now. Please contact support.
          </div>
        ) : (
          <div className="space-y-3">
            {banks.map((b) => {
              const bankKey = b.id || b.bank;
              const copied = copiedKey === bankKey;
              return (
                <div
                  key={bankKey}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl bg-[#F8F5EC] border border-[#EAE6D7]"
                >
                  <div>
                    <div className="font-medium text-[#2D3A33]">{b.bank}</div>
                    <div className="text-sm text-[#5C6C62]">{b.account_holder}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-[#2D3A33]">{b.account_number}</span>
                    <button
                      type="button"
                      onClick={() => copy(b.account_number, bankKey)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        copied
                          ? "bg-[#EDF3EF] text-[#52796F]"
                          : "bg-white border border-[#EAE6D7] text-[#2D3A33] hover:bg-[#FBF8EF]"
                      }`}
                      data-testid={`bank-${b.bank.toLowerCase()}`}
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> Copy number
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 3: Upload payment proof */}
      <div className="mt-5 bl-card p-5 sm:p-6">
        <StepHeader step={3} title="Upload payment proof" />
        {submitted ? (
          <div className="flex items-center gap-2 text-sm text-[#52796F]" data-testid="checkout-success">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Submitted — activation within 1×24 hours.
          </div>
        ) : (
          <>
            <label
              htmlFor="proof-input"
              className="flex flex-col items-center justify-center gap-2 p-8 rounded-xl border-2 border-dashed border-[#EAE6D7] bg-[#FBF8EF] cursor-pointer hover:border-[#52796F]/40 hover:bg-[#F8F5EC] transition text-center"
            >
              {file ? (
                <>
                  <FileText className="w-8 h-8 text-[#52796F]" />
                  <span className="text-sm font-medium text-[#2D3A33]">{file.name}</span>
                  <span className="text-xs text-[#5C6C62]">Click to choose a different file</span>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-[#8A9A86]" />
                  <span className="text-sm font-medium text-[#2D3A33]">
                    Upload screenshot, receipt, or bank transfer proof.
                  </span>
                  <span className="text-xs text-[#5C6C62]">Allowed: JPG, PNG, PDF</span>
                </>
              )}
              <input
                id="proof-input"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="sr-only"
                data-testid="proof-input"
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="bl-btn-primary mt-4 w-full sm:w-auto disabled:opacity-50"
              data-testid="payment-submit"
            >
              {busy ? "Submitting…" : "Submit payment proof"}
            </button>
          </>
        )}
      </div>

      {support.whatsapp && (
        <div className="mt-5 bl-card p-5 sm:p-6" data-testid="magic-link-card">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#2D3A33]">Need faster activation?</div>
              <p className="text-sm text-[#5C6C62] mt-1 max-w-lg">
                After transferring, send your payment details on WhatsApp. We usually verify faster during
                business hours{support.hours ? ` (${support.hours})` : ""}.
              </p>
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-[#EAE6D7] text-[#2D3A33] hover:bg-[#FBF8EF] transition"
                data-testid="magic-wa-link"
              >
                <MessageCircle className="w-4 h-4 text-[#25D366]" />
                Open WhatsApp with details
              </a>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="p-2 rounded-lg border border-[#EAE6D7] bg-white" data-testid="magic-qr-code">
                <QRCodeSVG
                  value={waLink}
                  size={72}
                  bgColor="#FFFFFF"
                  fgColor="#2D3A33"
                  level="M"
                  includeMargin={false}
                />
              </div>
              <div className="text-xs text-[#5C6C62]">
                Scan with
                <br />
                your phone
              </div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-[#EAE6D7] text-xs text-[#5C6C62]">
            Support WhatsApp: <span className="font-mono text-[#2D3A33]">+{support.whatsapp}</span>
            {" · "}
            <button
              type="button"
              onClick={() => copy(`+${support.whatsapp}`, "whatsapp")}
              className="text-[#52796F] hover:underline font-medium"
              data-testid="magic-copy-number"
            >
              {copiedKey === "whatsapp" ? "Copied" : "Copy number"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
