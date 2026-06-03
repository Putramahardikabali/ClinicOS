import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import ConsentStatusBadge, { consentSummary } from "@/components/consent/ConsentStatusBadge";
import { ROLE_LABEL } from "@/lib/auth";
import { formatBillingLabel, primaryAndAdditionalPerformers } from "@/lib/visitUi";
import { bookedTreatmentLabel, buildVisitClinicalAlerts } from "@/lib/visitWorkflow";

export default function VisitStepOverview({
  visit,
  invoice,
  showBilling,
  canCollect,
}) {
  const { primary, additional } = primaryAndAdditionalPerformers(visit);
  const billing = formatBillingLabel(visit, invoice);
  const booked = bookedTreatmentLabel(visit);
  const consentInfo = consentSummary(visit.consent_forms || []);
  const alerts = buildVisitClinicalAlerts(visit, { invoice, showBilling });

  return (
    <div className="space-y-6" data-testid="visit-step-overview">
      {alerts.length > 0 && (
        <div className="bl-card p-4 border-[#F1C9B7] bg-[#FEF3E8]" data-testid="visit-important-alerts">
          <div className="flex items-center gap-2 text-[#92400E] font-medium text-sm mb-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Important
          </div>
          <ul className="text-sm text-[#5C6C62] space-y-1">
            {alerts.map((a) => (
              <li key={a.key} data-testid={`visit-alert-${a.key}`}>
                <span className="font-medium text-[#2D3A33]">{a.label}</span>
                {a.detail ? ` — ${a.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Patient</div>
          <div className="font-display text-xl text-[#2D3A33]">{visit.patient.full_name}</div>
          <div className="text-sm text-[#5C6C62] mt-1 capitalize">
            {visit.patient.gender || "—"}
            {visit.patient.date_of_birth ? ` · DOB ${visit.patient.date_of_birth}` : ""}
          </div>
          <div className="mt-3 text-sm space-y-1">
            <div><span className="text-[#5C6C62]">Phone:</span> {visit.patient.phone || "—"}</div>
            <div><span className="text-[#5C6C62]">Email:</span> {visit.patient.email || "—"}</div>
            <div><span className="text-[#5C6C62]">Allergies:</span> {visit.patient.allergies || "—"}</div>
          </div>
        </div>

        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Visit details</div>
          <div className="text-sm space-y-1.5">
            <div><span className="text-[#5C6C62]">Type:</span> <span className="capitalize">{visit.visit_type}</span></div>
            <div><span className="text-[#5C6C62]">Date:</span> {new Date(visit.visit_date || visit.created_at).toLocaleString()}</div>
            <div>
              <span className="text-[#5C6C62]">Status:</span>{" "}
              <span className={`bl-chip ${visit.status === "completed" ? "success" : visit.status === "submitted" ? "warning" : "info"}`}>
                {visit.status.replace("_", " ")}
              </span>
            </div>
            {showBilling && (
              <div>
                <span className="text-[#5C6C62]">Payment:</span>{" "}
                <span className={`bl-chip ${billing.chip}`}>{billing.label}</span>
              </div>
            )}
            {canCollect && (
              <div className="pt-2">
                <Link to={`/invoices/visit/${visit.id}`} className="text-sm font-medium" style={{ color: "var(--bl-primary)" }}>
                  Open invoice →
                </Link>
              </div>
            )}
            {(visit.consent_required || (visit.consent_forms || []).length > 0) && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[#5C6C62]">Consent:</span>
                <ConsentStatusBadge status={consentInfo.status} compact />
              </div>
            )}
          </div>
        </div>

        <div className="bl-card p-5 lg:col-span-2">
          <div className="label-eyebrow mb-3">Performers &amp; treatment</div>
          <div className="text-sm space-y-2">
            {primary && (
              <div>
                <span className="text-[#5C6C62]">Primary performer:</span>{" "}
                <span className="font-medium text-[#2D3A33]">
                  {primary.staff_name_snapshot || visit.assigned_user?.name}
                  {(primary.staff_role_snapshot || visit.assigned_user?.role) && (
                    <> ({ROLE_LABEL[primary.staff_role_snapshot || visit.assigned_user?.role] || primary.staff_role_snapshot})</>
                  )}
                </span>
              </div>
            )}
            {additional.length > 0 && (
              <div>
                <span className="text-[#5C6C62]">Additional performers:</span>{" "}
                {additional.map((p, i) => (
                  <span key={p.staff_id || i}>
                    {i > 0 ? ", " : ""}
                    {p.staff_name_snapshot || p.staff_id}
                    {p.staff_role_snapshot ? ` (${ROLE_LABEL[p.staff_role_snapshot] || p.staff_role_snapshot})` : ""}
                  </span>
                ))}
              </div>
            )}
            <div>
              <span className="text-[#5C6C62]">Treatment booked:</span>{" "}
              <span className="font-medium text-[#2D3A33]">{booked || "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
