import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { visitHasTreatmentContext } from "@/lib/visitUi";
import { toast } from "sonner";
import {
  Shield,
  Send,
  FileSignature,
  Ban,
  RefreshCw,
  ExternalLink,
  Eye,
  AlertCircle,
  CheckCircle2,
  Link2,
  Copy,
  MessageSquare,
} from "lucide-react";
import ConsentStatusBadge from "@/components/consent/ConsentStatusBadge";
import ConsentSignDialog from "@/components/consent/ConsentSignDialog";

function ConsentFormPreview({ form, patientName }) {
  const snap = form?.template_snapshot || {};
  return (
    <div className="mt-3 p-4 bg-[#F8F5EC] rounded-lg text-sm space-y-3" data-testid="consent-form-preview">
      <div className="text-xs text-[#5C6C62]">
        {patientName && <div>Patient: <span className="text-[#2D3A33]">{patientName}</span></div>}
        {form?.performer_name_snapshot && (
          <div>Performer: <span className="text-[#2D3A33]">{form.performer_name_snapshot}</span></div>
        )}
        {form?.treatment_name_snapshot && (
          <div>Treatment: <span className="text-[#2D3A33]">{form.treatment_name_snapshot}</span></div>
        )}
      </div>
      {(snap.sections || []).length > 0 ? (
        snap.sections.map((s, i) => (
          <div key={i}>
            {s.heading && <div className="font-medium text-[#2D3A33]">{s.heading}</div>}
            <p className="text-[#5C6C62] whitespace-pre-wrap mt-1">{s.content}</p>
          </div>
        ))
      ) : (
        <p className="text-[#5C6C62] whitespace-pre-wrap">{snap.body || "—"}</p>
      )}
      {form?.status === "signed" && form?.patient_signature && (
        <div className="pt-2 border-t border-[#EAE6D7]">
          <div className="text-xs text-[#5C6C62] mb-1">Patient signature</div>
          <img src={form.patient_signature} alt="Patient signature" className="h-16 max-w-[200px] border border-[#EAE6D7] rounded bg-white" />
        </div>
      )}
    </div>
  );
}

function TreatmentConsentSummary({ treatments = [] }) {
  if (!treatments.length) return null;
  return (
    <ul className="mt-3 space-y-2 text-sm" data-testid="consent-treatment-summary">
      {treatments.map((t) => (
        <li key={t.linked_name} className="flex flex-wrap items-center gap-2">
          <span className="text-[#2D3A33]">{t.catalog_name || t.linked_name}</span>
          {t.consent_required ? (
            <span className="bl-chip warning text-[10px]">Consent required</span>
          ) : (
            <span className="bl-chip text-[10px]">Not required</span>
          )}
          {!t.catalog_matched && (
            <span className="text-xs text-[#B45309]">Not matched in catalog</span>
          )}
          {t.consent_required && !t.has_template && (
            <span className="text-xs text-[#B45309]">No template configured</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function isAssignedToVisit(user, visit) {
  if (!user?.id) return false;
  if (visit?.assigned_user?.id === user.id || visit?.assigned_to === user.id) return true;
  return (visit?.performers || []).some((p) => p.staff_id === user.id);
}

export default function VisitConsentPanel({ visit, onUpdated, compact = false }) {
  const { user } = useAuth();
  const [forms, setForms] = useState(visit?.consent_forms || []);
  const [context, setContext] = useState(visit?.consent_context || null);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [signForm, setSignForm] = useState(null);
  const [openFormId, setOpenFormId] = useState(null);
  const [prepareHint, setPrepareHint] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [automationActive, setAutomationActive] = useState(false);

  const patientName = visit?.patient?.full_name || "";
  const consentRequired = Boolean(context?.consent_required ?? visit?.consent_required);
  const hasTreatmentContext = Boolean(
    context?.treatment_names?.length
    || visitHasTreatmentContext(visit),
  );
  const contextTreatments = context?.treatments || [];

  const canPrepare =
    hasPermission(user, "consent.send")
    || ["fo", "manager", "super_admin", "owner"].includes(user?.role);
  const canManage =
    hasPermission(user, "consent.manage")
    || user?.platform_admin
    || ["manager", "super_admin", "owner"].includes(user?.role);
  const assignedClinical =
    isAssignedToVisit(user, visit)
    && ["doctor", "therapist", "nurse"].includes(user?.role);
  const canCollectSignature = canPrepare || assignedClinical;
  const canView =
    canPrepare
    || hasPermission(user, "consent.view")
    || ["doctor", "therapist", "nurse"].includes(user?.role);

  const load = useCallback(async () => {
    if (!visit?.id) return;
    setLoading(true);
    try {
      const [formsRes, ctxRes] = await Promise.all([
        api.get(`/visits/${visit.id}/consent-forms`),
        api.get(`/visits/${visit.id}/consent-context`).catch(() => ({ data: visit?.consent_context || null })),
      ]);
      setForms(formsRes.data || []);
      setContext(ctxRes.data || visit?.consent_context || null);
    } catch {
      setForms(visit?.consent_forms || []);
      setContext(visit?.consent_context || null);
    } finally {
      setLoading(false);
    }
  }, [visit?.id, visit?.consent_forms, visit?.consent_context]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get("/settings/messaging").then((r) => setAutomationActive(!!r.data?.automation_active)).catch(() => {});
  }, []);

  const activeForms = useMemo(
    () => forms.filter((f) => f.status !== "cancelled"),
    [forms],
  );

  if (!canView) {
    return (
      <div className="bl-card p-6 text-sm text-[#5C6C62]" data-testid="visit-consent-panel-denied">
        You do not have permission to view consent for this visit.
      </div>
    );
  }

  const ensureForms = async (force = false) => {
    setPreparing(true);
    setPrepareHint("");
    try {
      const r = await api.post(`/visits/${visit.id}/consent-forms/ensure`, null, {
        params: force ? { force: true } : {},
      });
      const { created = 0, warnings = [] } = r.data || {};
      if (created > 0) {
        toast.success(created === 1 ? "Consent form prepared" : `${created} consent forms prepared`);
      } else if (warnings.length) {
        setPrepareHint(warnings.join(" "));
        toast.warning(warnings[0]);
      } else if (activeForms.length > 0 || (r.data?.forms || []).length > 0) {
        toast.info("Consent forms are already prepared for this visit.");
      } else if (!consentRequired && !force) {
        toast.info("No consent-required treatments found. Use “Prepare anyway” if your clinic policy requires it.");
      } else {
        setPrepareHint("Could not prepare consent forms. Add an active consent template for this treatment in Admin.");
        toast.error("No consent forms were created");
      }
      await load();
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not prepare consent");
    } finally {
      setPreparing(false);
    }
  };

  const sendForm = async (formId) => {
    try {
      await api.post(`/consent-forms/${formId}/send`);
      toast.success("Marked as pending signature");
      load();
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update consent");
    }
  };

  const signFormApi = async (formId, payload) => {
    await api.put(`/consent-forms/${formId}/sign`, payload);
    toast.success("Consent signed");
    setSignForm(null);
    setOpenFormId(null);
    load();
    onUpdated?.();
  };

  const cancelForm = async (formId) => {
    const reason = window.prompt("Reason for cancellation (optional)") || "";
    try {
      await api.post(`/consent-forms/${formId}/cancel`, { reason });
      toast.success("Consent cancelled");
      load();
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel");
    }
  };

  const generatePublicLink = async (formId) => {
    setLinkBusy(true);
    setLinkUrl("");
    try {
      const r = await api.post(`/consent-forms/${formId}/public-link`, {});
      const url = r.data?.url || r.data?.public_link?.url;
      if (url) {
        setLinkUrl(url);
        toast.success("Public consent link generated");
      }
      load();
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not generate link");
    } finally {
      setLinkBusy(false);
    }
  };

  const copyPublicLink = async (url) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  const cancelPublicLink = async (formId) => {
    try {
      await api.post(`/consent-forms/${formId}/public-link/cancel`);
      setLinkUrl("");
      toast.success("Public link cancelled");
      load();
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not cancel link");
    }
  };

  const regeneratePublicLink = async (formId) => {
    setLinkBusy(true);
    try {
      const r = await api.post(`/consent-forms/${formId}/public-link/regenerate`, {});
      const url = r.data?.url;
      if (url) {
        setLinkUrl(url);
        toast.success("New link generated");
      }
      load();
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not regenerate link");
    } finally {
      setLinkBusy(false);
    }
  };

  const sendLinkViaMessaging = async (formId) => {
    setLinkBusy(true);
    try {
      const r = await api.post(`/consent-forms/${formId}/public-link/send`);
      const url = r.data?.url;
      if (url) setLinkUrl(url);
      toast.success("Consent link sent via messaging");
      load();
      onUpdated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not send link");
    } finally {
      setLinkBusy(false);
    }
  };

  const renderEmptyState = () => {
    if (!hasTreatmentContext) {
      return (
        <div className="rounded-xl border border-[#EAE6D7] p-5 bg-[#F8F5EC]" data-testid="consent-no-treatment">
          <div className="flex gap-3">
            <AlertCircle className="w-5 h-5 text-[#5C6C62] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-[#2D3A33] font-medium">Treatment not linked yet</p>
              <p className="text-sm text-[#5C6C62] mt-1">
                Add a treatment item on the Treatment Items tab, or link a booking, to determine consent requirements.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (consentRequired) {
      return (
        <div className="rounded-xl border border-[#EAE6D7] p-5 bg-[#F8F5EC]" data-testid="consent-required-empty">
          <p className="text-sm text-[#2D3A33] font-medium">Consent is required for this visit.</p>
          <p className="text-sm text-[#5C6C62] mt-1">
            Prepare and collect consent before treatment begins.
          </p>
          <TreatmentConsentSummary treatments={contextTreatments} />
          {prepareHint && (
            <p className="text-sm text-[#B45309] mt-3 bg-[#FEF3C7] rounded-lg px-3 py-2">{prepareHint}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {canPrepare && (
              <button
                type="button"
                onClick={() => ensureForms(false)}
                disabled={preparing}
                className="bl-btn-primary text-sm inline-flex items-center gap-1.5"
                data-testid="prepare-consent-forms"
              >
                <RefreshCw className={`w-4 h-4 ${preparing ? "animate-spin" : ""}`} />
                Prepare consent forms
              </button>
            )}
            {!canPrepare && assignedClinical && (
              <p className="text-sm text-[#5C6C62]">
                Ask front office to prepare consent forms. Once prepared, you can open and collect signatures here.
              </p>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-xl border border-[#EAE6D7] p-5 bg-[#F8F5EC]" data-testid="consent-not-required">
        <div className="flex gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#52796F] shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-[#2D3A33] font-medium">
              Consent is not required for the selected treatment.
            </p>
            <TreatmentConsentSummary treatments={contextTreatments} />
            <p className="text-sm text-[#5C6C62] mt-3">
              {assignedClinical && !canPrepare
                ? "If your clinic policy requires consent anyway, ask front office to prepare a form."
                : "You can still prepare consent manually if your clinic policy requires it."}
            </p>
            {prepareHint && (
              <p className="text-sm text-[#B45309] mt-3 bg-[#FEF3C7] rounded-lg px-3 py-2">{prepareHint}</p>
            )}
            {canPrepare && context?.has_preparable_template && (
              <button
                type="button"
                onClick={() => ensureForms(true)}
                disabled={preparing}
                className="bl-btn-ghost text-sm mt-4 inline-flex items-center gap-1.5"
                data-testid="prepare-consent-anyway"
              >
                <RefreshCw className={`w-4 h-4 ${preparing ? "animate-spin" : ""}`} />
                Prepare consent forms anyway
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderFormCard = (f) => {
    const isOpen = openFormId === f.id;
    const isPending = ["pending", "not_sent", "draft"].includes(f.status);
    const isSigned = f.status === "signed";
    const isInactive = f.status === "expired" || f.status === "cancelled";
    const pl = f.public_link;
    const hasActiveLink = pl?.has_active_link;
    const displayUrl = linkUrl && openFormId === f.id ? linkUrl : null;

    return (
      <div
        key={f.id}
        className={`${compact ? "bl-card p-4" : "border border-[#EAE6D7] rounded-xl p-4"}`}
        data-testid={`consent-form-${f.id}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-[#2D3A33]">{f.treatment_name_snapshot || "Treatment consent"}</div>
            <div className="text-xs text-[#5C6C62] mt-1 space-y-0.5">
              {(f.template_snapshot?.title || f.template_snapshot?.name) && (
                <div>{f.template_snapshot.title || f.template_snapshot.name}</div>
              )}
              {patientName && <div>Patient: {patientName}</div>}
              {f.performer_name_snapshot && <div>Performer: {f.performer_name_snapshot}</div>}
              {isSigned && f.signed_at && (
                <div>Signed {new Date(f.signed_at).toLocaleString()}</div>
              )}
              {isSigned && f.staff_signed_by_name && (
                <div>Signed by staff: {f.staff_signed_by_name}</div>
              )}
            </div>
          </div>
          <ConsentStatusBadge status={f.status} />
        </div>

        {isPending && (
          <p className="text-sm text-[#5C6C62] mt-3">
            {f.status === "not_sent"
              ? "Form prepared — ready to collect signature."
              : "Pending signature — review with the patient and mark as signed."}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {(isPending || isSigned) && (
            <button
              type="button"
              onClick={() => setOpenFormId(isOpen ? null : f.id)}
              className="bl-btn-ghost text-xs inline-flex items-center gap-1"
              data-testid={isSigned ? "consent-view-signed" : "consent-open-form"}
            >
              {isSigned ? <Eye className="w-3.5 h-3.5" /> : <ExternalLink className="w-3.5 h-3.5" />}
              {isOpen ? "Hide consent" : isSigned ? "View signed consent" : "Open consent form"}
            </button>
          )}

          {isPending && canCollectSignature && (
            <>
              {canPrepare && f.status === "not_sent" && (
                <button
                  type="button"
                  onClick={() => sendForm(f.id)}
                  className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" /> Mark pending
                </button>
              )}
              <button
                type="button"
                onClick={() => setSignForm(f)}
                className="bl-btn-primary text-xs inline-flex items-center gap-1"
                data-testid="consent-mark-signed"
              >
                <FileSignature className="w-3.5 h-3.5" /> Mark as signed
              </button>
            </>
          )}

          {isPending && (canManage || canPrepare) && (
            <button
              type="button"
              onClick={() => cancelForm(f.id)}
              className="bl-btn-ghost text-xs text-[#B14A2C] inline-flex items-center gap-1"
            >
              <Ban className="w-3.5 h-3.5" /> Cancel consent
            </button>
          )}

          {isPending && canPrepare && (
            <>
              {!hasActiveLink && (
                <button
                  type="button"
                  onClick={() => { setOpenFormId(f.id); generatePublicLink(f.id); }}
                  disabled={linkBusy}
                  className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                  data-testid={`consent-generate-link-${f.id}`}
                >
                  <Link2 className="w-3.5 h-3.5" /> Generate public link
                </button>
              )}
              {hasActiveLink && (
                <>
                  <button
                    type="button"
                    onClick={() => { setOpenFormId(f.id); regeneratePublicLink(f.id); }}
                    disabled={linkBusy}
                    className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${linkBusy ? "animate-spin" : ""}`} /> Regenerate link
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelPublicLink(f.id)}
                    className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                  >
                    Cancel link
                  </button>
                </>
              )}
              {displayUrl && (
                <button
                  type="button"
                  onClick={() => copyPublicLink(displayUrl)}
                  className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                  data-testid="consent-copy-link"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy link
                </button>
              )}
              {automationActive && canPrepare && (
                <button
                  type="button"
                  onClick={() => sendLinkViaMessaging(f.id)}
                  disabled={linkBusy}
                  className="bl-btn-ghost text-xs inline-flex items-center gap-1"
                  data-testid="consent-send-link"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Send via messaging
                </button>
              )}
            </>
          )}

          {pl?.status && isPending && (
            <span className="text-xs text-[#5C6C62] capitalize bl-chip info">
              Link: {pl.status.replace(/_/g, " ")}
            </span>
          )}

          {isInactive && (canManage || canPrepare) && (
            <button
              type="button"
              onClick={() => ensureForms(consentRequired ? false : true)}
              disabled={preparing}
              className="bl-btn-primary text-xs inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${preparing ? "animate-spin" : ""}`} />
              Prepare new consent
            </button>
          )}
        </div>

        {isOpen && (isPending || isSigned) && (
          <ConsentFormPreview form={f} patientName={patientName} />
        )}

        {isInactive && (
          <p className="mt-3 text-sm text-[#5C6C62] capitalize">
            This consent form is {f.status}.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className={compact ? "" : "bl-card p-5 space-y-4"} data-testid="visit-consent-panel">
      {!compact && (
        <div>
          <div className="label-eyebrow flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" /> Digital consent
          </div>
          <p className="text-sm text-[#5C6C62] mt-1">
            Prepare, collect, and review consent linked to this visit.
          </p>
        </div>
      )}

      {loading && <p className="text-sm text-[#5C6C62]">Loading consent…</p>}

      {!loading && activeForms.length === 0 && renderEmptyState()}

      {!loading && activeForms.length > 0 && (
        <div className="space-y-3">
          {activeForms.map(renderFormCard)}
        </div>
      )}

      {!loading && forms.some((f) => f.status === "cancelled") && (
        <details className="text-sm text-[#5C6C62]">
          <summary className="cursor-pointer">Cancelled forms ({forms.filter((f) => f.status === "cancelled").length})</summary>
          <div className="mt-2 space-y-2 opacity-75">
            {forms.filter((f) => f.status === "cancelled").map(renderFormCard)}
          </div>
        </details>
      )}

      {signForm && (
        <ConsentSignDialog
          form={signForm}
          onClose={() => setSignForm(null)}
          onSigned={(payload) => signFormApi(signForm.id, payload)}
        />
      )}
    </div>
  );
}
