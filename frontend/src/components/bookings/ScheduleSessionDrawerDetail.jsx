import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import api from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import {
  bookedTreatmentLabel,
  performedTreatmentItems,
  primaryVisitNoteRole,
} from "@/lib/visitWorkflow";
import {
  clinicalNotesSummaryText,
  canOpenSessionWorkflow,
  formatSessionDate,
  formatSessionTime,
  sessionStatusChip,
  visitTypeLabel,
} from "@/lib/scheduleSessionsDrawer";
import { formatBillingLabel, primaryAndAdditionalPerformers } from "@/lib/visitUi";

function DetailRow({ label, children }) {
  return (
    <div className="py-2 border-b border-[#EAE6D7] last:border-0">
      <div className="text-[10px] uppercase tracking-wide text-[#A89F8B] mb-0.5">{label}</div>
      <div className="text-sm text-[#2D3A33]">{children}</div>
    </div>
  );
}

function OpenLink({ to, label }) {
  return (
    <a
      href={to}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-[#52796F] hover:text-[#2D3A33] hover:underline"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      {label}
    </a>
  );
}

export function ScheduleSessionDrawerDetail({ visitId, onBack }) {
  const { user } = useAuth();
  const [visit, setVisit] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const canViewBilling =
    hasPermission(user, "billing.view")
    || ["super_admin", "fo", "manager"].includes(user?.role);
  const canViewInvoice = canViewBilling && Boolean(visit?.invoice_id || invoice?.id);

  const load = useCallback(() => {
    if (!visitId) return Promise.resolve();
    setLoading(true);
    setError("");
    return api
      .get(`/visits/${visitId}`)
      .then((r) => setVisit(r.data))
      .catch((e) => {
        setVisit(null);
        setError(e?.response?.data?.detail || "Could not load session");
      })
      .finally(() => setLoading(false));
  }, [visitId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!visitId || !canViewBilling) {
      setInvoice(null);
      return;
    }
    api
      .get(`/invoices/visit/${visitId}`)
      .then((r) => setInvoice(r.data))
      .catch(() => setInvoice(null));
  }, [visitId, canViewBilling]);

  const billing = useMemo(
    () => formatBillingLabel(visit, invoice),
    [visit, invoice],
  );

  const notesSummary = useMemo(
    () => (visit ? clinicalNotesSummaryText(visit, user) : null),
    [visit, user],
  );

  const { primary, additional } = useMemo(
    () => (visit ? primaryAndAdditionalPerformers(visit) : { primary: null, additional: [] }),
    [visit],
  );

  const performed = useMemo(
    () => (visit ? performedTreatmentItems(visit) : []),
    [visit],
  );

  const photoCount = visit?.photos?.length || 0;
  const productUsages = visit?.product_usages || [];
  const bookingNote = (visit?.booking?.notes || "").trim();
  const bookedTreatment = visit ? bookedTreatmentLabel(visit) : "";
  const showOpenWorkflow = visit && canOpenSessionWorkflow(user, visit);

  if (loading) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="px-4 py-3 border-b border-[#EAE6D7] shrink-0 flex items-center gap-2">
          <button type="button" onClick={onBack} className="p-1 rounded hover:bg-[#F3F1EB] text-[#5C6C62]">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="font-display text-lg text-[#2D3A33]">Session</h2>
        </div>
        <div className="flex-1 px-4 py-6 text-sm text-[#5C6C62]">Loading session…</div>
      </div>
    );
  }

  if (error || !visit) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="px-4 py-3 border-b border-[#EAE6D7] shrink-0 flex items-center gap-2">
          <button type="button" onClick={onBack} className="p-1 rounded hover:bg-[#F3F1EB] text-[#5C6C62]">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="font-display text-lg text-[#2D3A33]">Session</h2>
        </div>
        <div className="flex-1 px-4 py-6 text-sm text-[#B14A2C]">{error || "Session not found"}</div>
      </div>
    );
  }

  const staffLabel = [
    primary?.staff_name_snapshot,
    ...additional.map((p) => p.staff_name_snapshot),
  ].filter(Boolean).join(", ") || "—";

  const invoiceId = invoice?.id || visit.invoice_id;

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="schedule-session-detail">
      <div className="px-4 py-3 border-b border-[#EAE6D7] shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-[#52796F] hover:text-[#2D3A33] mb-2"
          data-testid="schedule-session-back"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to sessions
        </button>
        <h2 className="font-display text-lg text-[#2D3A33] truncate">{visit.patient?.full_name || visit.patient_name}</h2>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[#5C6C62]">
          <span>{visitTypeLabel(visit.visit_type)}</span>
          <span className={`bl-chip ${sessionStatusChip(visit.status)}`}>
            {(visit.status || "").replace("_", " ")}
          </span>
          <span className={`bl-chip ${billing.chip}`}>{billing.label}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
        <DetailRow label="Patient">
          {visit.patient?.full_name || visit.patient_name || "—"}
          {visit.patient?.phone ? (
            <div className="text-xs text-[#5C6C62] mt-0.5">{visit.patient.phone}</div>
          ) : null}
        </DetailRow>

        <DetailRow label="Session type">
          <span className="capitalize">{visit.visit_type || primaryVisitNoteRole(visit) || "—"}</span>
        </DetailRow>

        {(bookedTreatment || performed.length > 0) && (
          <DetailRow label="Treatment">
            {bookedTreatment && <div>{bookedTreatment}</div>}
            {performed.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-[#5C6C62]">
                {performed.map((it) => (
                  <li key={it.id}>{it.name}{it.area_treated ? ` · ${it.area_treated}` : ""}</li>
                ))}
              </ul>
            )}
            {!bookedTreatment && performed.length === 0 && "—"}
          </DetailRow>
        )}

        <DetailRow label="Assigned staff">{staffLabel}</DetailRow>

        <DetailRow label="Date & time">
          {formatSessionDate(visit)} · {formatSessionTime(visit)}
        </DetailRow>

        {bookingNote && (
          <DetailRow label="Booking note">{bookingNote}</DetailRow>
        )}

        {notesSummary && (
          <DetailRow label="Clinical notes summary">
            <p className="text-[#5C6C62] whitespace-pre-wrap">{notesSummary}</p>
          </DetailRow>
        )}

        <DetailRow label="Photos">{photoCount} photo{photoCount === 1 ? "" : "s"}</DetailRow>

        {productUsages.length > 0 && (
          <DetailRow label="Products used">
            <ul className="space-y-0.5 text-xs text-[#5C6C62]">
              {productUsages.map((u) => (
                <li key={u.id}>
                  {u.product_name || u.name || "Product"}
                  {u.quantity != null ? ` × ${u.quantity}` : ""}
                </li>
              ))}
            </ul>
          </DetailRow>
        )}

        {canViewInvoice && (
          <DetailRow label="Invoice">
            {invoiceId ? (
              <span>
                {invoice?.invoice_number || invoiceId.slice(0, 8)}
                {" · "}
                <span className="capitalize">{invoice?.payment_status || sessionPaymentLabel(visit).label}</span>
              </span>
            ) : (
              <span className="text-[#5C6C62]">No invoice yet</span>
            )}
          </DetailRow>
        )}

        <DetailRow label="Timestamps">
          <div className="space-y-0.5 text-xs text-[#5C6C62]">
            {visit.created_at && <div>Created: {new Date(visit.created_at).toLocaleString()}</div>}
            {visit.submitted_at && <div>Submitted: {new Date(visit.submitted_at).toLocaleString()}</div>}
            {visit.completed_at && <div>Completed: {new Date(visit.completed_at).toLocaleString()}</div>}
          </div>
        </DetailRow>
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-[#EAE6D7] bg-[#FAFAF7] space-y-2">
        <OpenLink to={`/visits/${visit.id}`} label="Open full session record" />
        {visit.patient_id && (
          <OpenLink to={`/patients/${visit.patient_id}`} label="Open patient profile" />
        )}
        {invoiceId && canViewInvoice && (
          <OpenLink to={`/invoices/${invoiceId}`} label="Show invoice" />
        )}
        {visit.booking_id && (
          <OpenLink to={`/bookings?open=${visit.booking_id}`} label="Open appointment" />
        )}
        {showOpenWorkflow && (
          <OpenLink to={`/visits/${visit.id}`} label="Open session workflow" />
        )}
      </div>
    </div>
  );
}
