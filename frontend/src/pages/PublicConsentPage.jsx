import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/api";
import { logoUrl } from "@/lib/settings";
import { toast } from "sonner";
import SignaturePad from "@/components/SignaturePad";
import { Check, Shield, AlertCircle } from "lucide-react";

export default function PublicConsentPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get(`/public/consent/${token}`)
      .then((r) => {
        setData(r.data);
        if (r.data.signed) setSubmitted(true);
      })
      .catch((e) => {
        setError(e?.response?.data?.detail || "Consent link not found or expired");
      })
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (!signature) {
      toast.error("Please sign in the box below");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/public/consent/${token}/sign`, { patient_signature: signature });
      setSubmitted(true);
      toast.success("Consent submitted successfully");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not submit consent");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-[#5C6C62]">Loading consent form…</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FDFBF7] p-6" data-testid="public-consent-error">
        <div className="bl-card p-8 max-w-md text-center">
          <AlertCircle className="w-10 h-10 text-[#B45309] mx-auto" />
          <p className="mt-4 text-[#2D3A33] font-medium">{error}</p>
        </div>
      </div>
    );
  }

  const clinic = data?.clinic || {};
  const tpl = data?.template || {};
  const readOnly = submitted || data?.signed || !data?.can_sign;

  return (
    <div className="min-h-screen bg-[#FDFBF7]" data-testid="public-consent-page">
      <header className="border-b border-[#EAE6D7] bg-white">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center gap-3">
          {clinic.logo_path ? (
            <img src={logoUrl(clinic.logo_path)} alt="" className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#EDF3EF]">
              <Shield className="w-5 h-5 text-[#52796F]" />
            </div>
          )}
          <div>
            <div className="font-display text-lg text-[#2D3A33]">{clinic.name}</div>
            {clinic.phone && <div className="text-xs text-[#5C6C62]">{clinic.phone}</div>}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-5 py-8 pb-16">
        {submitted || data?.signed ? (
          <div className="bl-card p-8 text-center" data-testid="consent-success">
            <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-[#EDF3EF] text-[#52796F]">
              <Check className="w-7 h-7" />
            </div>
            <h1 className="font-display text-2xl text-[#2D3A33] mt-5">Consent completed</h1>
            <p className="text-[#5C6C62] mt-2">
              Thank you{data?.patient_name ? `, ${data.patient_name.split(" ")[0]}` : ""}. Your consent has been recorded.
            </p>
            <p className="text-sm text-[#5C6C62] mt-3">This form cannot be edited after submission.</p>
          </div>
        ) : (
          <>
            <div className="label-eyebrow">Informed consent</div>
            <h1 className="font-display text-3xl text-[#2D3A33] mt-2">{tpl.title || "Consent form"}</h1>
            <p className="text-sm text-[#5C6C62] mt-2">
              Please review and sign your consent form.
            </p>

            <div className="mt-6 bl-card p-5 space-y-2 text-sm">
              {data?.patient_name && (
                <div><span className="text-[#5C6C62]">Patient:</span> <span className="text-[#2D3A33] font-medium">{data.patient_name}</span></div>
              )}
              {data?.treatment_name && (
                <div><span className="text-[#5C6C62]">Treatment:</span> <span className="text-[#2D3A33]">{data.treatment_name}</span></div>
              )}
              {data?.performer_name && (
                <div><span className="text-[#5C6C62]">Practitioner:</span> <span className="text-[#2D3A33]">{data.performer_name}</span></div>
              )}
            </div>

            <div className="mt-6 bl-card p-5 prose prose-sm max-w-none">
              {(tpl.sections || []).length > 0 ? (
                tpl.sections.map((s, i) => (
                  <div key={i} className="mb-4">
                    {s.heading && <h3 className="font-medium text-[#2D3A33]">{s.heading}</h3>}
                    <p className="text-[#5C6C62] whitespace-pre-wrap mt-1">{s.content}</p>
                  </div>
                ))
              ) : (
                <p className="text-[#5C6C62] whitespace-pre-wrap">{tpl.body || "—"}</p>
              )}
            </div>

            {data?.requires_staff_signature && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                This consent requires in-clinic staff co-signature. Please complete signing at the clinic.
              </div>
            )}

            {!readOnly && (
              <>
                <p className="text-sm text-[#5C6C62] mt-6">
                  Your signature confirms that you have read and understood this consent.
                </p>
                <p className="text-xs text-[#5C6C62] mt-1 mb-3">
                  This form cannot be edited after submission.
                </p>
                <div className="bl-card p-5">
                  <div className="label-eyebrow mb-2">Your signature</div>
                  <SignaturePad value={signature} onChange={setSignature} testid="public-consent-signature" />
                </div>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || !signature}
                  className="bl-btn-primary mt-6 w-full min-h-[48px]"
                  data-testid="public-consent-submit"
                >
                  {busy ? "Submitting…" : "Submit consent"}
                </button>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
