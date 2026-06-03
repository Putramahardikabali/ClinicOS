import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api, { fileUrl } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { consentSummary } from "@/components/consent/ConsentStatusBadge";
import { formatBillingLabel, visitNoteTabRoles } from "@/lib/visitUi";

const EMPTY = "No data recorded";

function hasDoctorNoteContent(cr) {
  if (!cr) return false;
  return Boolean(
    cr.anamnesis || cr.diagnosis || cr.treatment_plan || cr.doctor_notes
    || cr.therapy_notes || cr.assessment,
  );
}

function hasTherapistNoteContent(tr) {
  if (!tr) return false;
  return Boolean(tr.concern_notes || tr.body_concern || tr.therapist_notes || tr.device_used || tr.area_treated);
}

function performerNameForRole(visit, role) {
  const match = (visit.performers || []).find(
    (p) => (p.staff_role_snapshot || "").toLowerCase() === role,
  );
  return match?.staff_name_snapshot || null;
}

function PrintSection({ title, children, show = true }) {
  if (!show) return null;
  return (
    <section className="mt-6 break-inside-avoid">
      <div className="text-xs uppercase tracking-[0.25em] text-[#8A9A86] border-b border-[#EAE6D7] pb-1">{title}</div>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

export default function PrintVisitPage() {
  const { vid } = useParams();
  const { settings } = useSettings();
  const [visit, setVisit] = useState(null);
  const [invoice, setInvoice] = useState(null);

  useEffect(() => {
    api.get(`/visits/${vid}`).then((r) => {
      setVisit(r.data);
      api.get(`/invoices/visit/${vid}`).then((ir) => setInvoice(ir.data)).catch(() => setInvoice(null));
    });
  }, [vid]);

  if (!visit) return <div className="p-10">Loading…</div>;

  const fmt = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
  const pat = visit.patient || {};
  const cr = visit.clinical_record;
  const tr = visit.therapist_record;
  const clinicName = settings?.branding?.clinic_name || "Clinic";
  const billing = formatBillingLabel(visit, invoice);
  const consent = consentSummary(visit.consent_forms || []);
  const noteRoles = visitNoteTabRoles(visit);
  const showDoctor = noteRoles.has("doctor");
  const showTherapist = noteRoles.has("therapist");
  const showNurse = noteRoles.has("nurse");
  const hasDoctor = hasDoctorNoteContent(cr);
  const hasTherapist = hasTherapistNoteContent(tr);
  const signatureCount = [showDoctor, showTherapist, showNurse].filter(Boolean).length;

  const renderAssessment = () => {
    if (!cr?.assessment) return <p className="text-[#5C6C62]">{EMPTY}</p>;
    const entries = Object.entries(cr.assessment).filter(([, v]) => v && Object.keys(v).length > 0);
    if (!entries.length) return <p className="text-[#5C6C62]">{EMPTY}</p>;
    return (
      <table className="w-full text-sm border border-[#2D3A33]/30">
        <tbody>
          {entries.map(([sec, subs]) => (
            <tr key={sec} className="border-b border-[#2D3A33]/20">
              <td className="px-2 py-1 font-semibold capitalize w-1/3 align-top">{sec.replace(/_/g, " ")}</td>
              <td className="px-2 py-1">{Object.entries(subs).map(([k, v]) => (v ? `${k}: ${v}` : null)).filter(Boolean).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderTherapistNoteBody = () => (
    <>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
        <div><div className="font-semibold">Concern</div><div className="whitespace-pre-wrap">{tr.concern_notes || EMPTY}</div></div>
        <div><div className="font-semibold">Body concern</div><div className="whitespace-pre-wrap">{tr.body_concern || EMPTY}</div></div>
        <div><div className="font-semibold">Device</div><div>{tr.device_used || EMPTY}</div></div>
        <div><div className="font-semibold">Area treated</div><div>{tr.area_treated || EMPTY}</div></div>
      </div>
      {tr.therapist_notes && (
        <div className="mt-3"><div className="font-semibold">Notes</div><div className="whitespace-pre-wrap">{tr.therapist_notes}</div></div>
      )}
      {tr.submitted_at && (
        <div className="mt-4 text-xs text-[#5C6C62]">
          Status: {tr.note_status || (tr.submitted ? "submitted" : "draft")}
          {` · ${new Date(tr.submitted_at).toLocaleString()}`}
          {tr.therapist_name ? ` · ${tr.therapist_name}` : ""}
        </div>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-white text-[#2D3A33]" style={{ fontFamily: "DM Sans, sans-serif" }}>
      <div className="no-print sticky top-0 bg-[#FDFBF7] border-b border-[#EAE6D7] p-4 flex items-center justify-between">
        <div className="font-display text-lg">Print preview · {pat.full_name}</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.close()} className="bl-btn-ghost text-sm">Close</button>
          <button type="button" onClick={() => window.print()} className="bl-btn-primary text-sm" data-testid="print-confirm">Print</button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-10 print-page">
        <div className="flex items-start justify-between border-b-2 border-[#2D3A33] pb-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-[#8A9A86]">{clinicName}</div>
            <div className="font-display text-2xl mt-1">Medical Record</div>
            <div className="text-sm text-[#5C6C62] mt-1 capitalize">{visit.visit_type} visit · {visit.status?.replace("_", " ")}</div>
          </div>
          <div className="text-right text-sm">
            <div><span className="text-[#5C6C62]">Record:</span> {visit.id.slice(0, 12)}</div>
            <div><span className="text-[#5C6C62]">Date:</span> {new Date(visit.visit_date || visit.created_at).toLocaleString()}</div>
            <div><span className="text-[#5C6C62]">Billing:</span> {billing.label}</div>
          </div>
        </div>

        <PrintSection title="Patient information">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
            <div><span className="text-[#5C6C62] inline-block w-28">Name</span>: <span className="font-medium">{pat.full_name || EMPTY}</span></div>
            <div><span className="text-[#5C6C62] inline-block w-28">Phone</span>: {pat.phone || EMPTY}</div>
            <div><span className="text-[#5C6C62] inline-block w-28">DOB</span>: {pat.date_of_birth || EMPTY}</div>
            <div><span className="text-[#5C6C62] inline-block w-28">Gender</span>: <span className="capitalize">{pat.gender || EMPTY}</span></div>
            <div className="col-span-2"><span className="text-[#5C6C62] inline-block w-28">Allergies</span>: {pat.allergies || EMPTY}</div>
          </div>
        </PrintSection>

        <PrintSection title="Visit details">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
            <div><span className="text-[#5C6C62]">Chief complaint</span>: {visit.chief_complaint || EMPTY}</div>
            <div><span className="text-[#5C6C62]">Assigned</span>: {visit.assigned_user?.name || EMPTY}</div>
            {(visit.performers || []).length > 0 && (
              <div className="col-span-2">
                <span className="text-[#5C6C62]">Performers</span>:{" "}
                {(visit.performers || []).map((p) => `${p.staff_name_snapshot || p.staff_id} (${p.performer_type || "primary"})`).join(", ") || EMPTY}
              </div>
            )}
          </div>
        </PrintSection>

        <PrintSection title="Doctor notes" show={showDoctor}>
          {hasDoctor ? (
            <>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <div><div className="font-semibold">Anamnesis</div><div className="whitespace-pre-wrap">{cr.anamnesis || EMPTY}</div></div>
                <div><div className="font-semibold">Diagnosis</div><div className="whitespace-pre-wrap">{cr.diagnosis || EMPTY}</div></div>
                <div><div className="font-semibold">Treatment plan</div><div className="whitespace-pre-wrap">{cr.treatment_plan || EMPTY}</div></div>
                <div><div className="font-semibold">Therapy notes</div><div className="whitespace-pre-wrap">{cr.therapy_notes || EMPTY}</div></div>
              </div>
              <div className="mt-4">
                <div className="font-semibold mb-2">Facial assessment</div>
                {renderAssessment()}
              </div>
              {cr.doctor_notes && (
                <div className="mt-3"><div className="font-semibold">Notes</div><div className="whitespace-pre-wrap">{cr.doctor_notes}</div></div>
              )}
              <div className="mt-4 text-xs text-[#5C6C62]">
                Status: {cr.note_status || (cr.submitted ? "submitted" : "draft")}
                {cr.submitted_at ? ` · ${new Date(cr.submitted_at).toLocaleString()}` : ""}
                {cr.doctor_name ? ` · ${cr.doctor_name}` : ""}
              </div>
            </>
          ) : (
            <p className="text-[#5C6C62]">{EMPTY}</p>
          )}
        </PrintSection>

        <PrintSection title="Therapist notes" show={showTherapist}>
          {hasTherapist ? renderTherapistNoteBody() : <p className="text-[#5C6C62]">{EMPTY}</p>}
        </PrintSection>

        <PrintSection title="Nurse notes" show={showNurse}>
          {hasTherapist ? renderTherapistNoteBody() : <p className="text-[#5C6C62]">{EMPTY}</p>}
        </PrintSection>

        <PrintSection title="Treatment items">
          {(visit.treatment_items || []).length > 0 ? (
            <table className="w-full text-sm border-t border-b border-[#2D3A33]/30">
              <thead className="text-left">
                <tr className="border-b border-[#2D3A33]/30">
                  <th className="py-1.5">Category</th><th>Name</th><th>Product</th><th>Area</th><th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {visit.treatment_items.map((it) => (
                  <tr key={it.id} className="border-b border-[#2D3A33]/10">
                    <td className="py-1.5">{it.category}</td><td>{it.name}</td><td>{it.product_used || "—"}</td><td>{it.area_treated || "—"}</td>
                    <td>{it.quantity} {it.unit_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[#5C6C62]">{EMPTY}</p>
          )}
        </PrintSection>

        <PrintSection title="Consent status">
          {(visit.consent_forms || []).length > 0 ? (
            <ul className="space-y-1">
              {visit.consent_forms.map((f) => (
                <li key={f.id}>
                  {f.treatment_name_snapshot || "Consent"} — {f.status?.replace("_", " ")}
                  {f.signed_at ? ` (${new Date(f.signed_at).toLocaleString()})` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[#5C6C62]">{EMPTY} · Summary: {consent.label}</p>
          )}
        </PrintSection>

        <PrintSection title="Photos summary">
          {(visit.photos || []).length > 0 ? (
            <div>
              <p>{visit.photos.length} photo(s) — Before: {(visit.photos || []).filter((p) => p.photo_type === "before").length}, After: {(visit.photos || []).filter((p) => p.photo_type === "after").length}, Follow-up: {(visit.photos || []).filter((p) => p.photo_type === "follow_up").length}</p>
              <div className="grid grid-cols-4 gap-2 mt-3">
                {visit.photos.slice(0, 8).map((p) => (
                  <div key={p.id} className="text-center text-xs">
                    <img src={fileUrl(p.storage_path)} alt={p.angle} className="w-full aspect-[3/4] object-cover border border-[#EAE6D7] rounded" />
                    <div className="mt-1 capitalize">{p.photo_type?.replace("_", " ")}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[#5C6C62]">{EMPTY}</p>
          )}
        </PrintSection>

        <PrintSection title="Mapping">
          {(visit.mappings || []).length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {visit.mappings.map((m) => (
                <div key={m.id} className="text-center">
                  <img src={m.image_data} alt={m.map_type} className="border border-[#EAE6D7] rounded max-h-48 mx-auto" />
                  <div className="text-xs text-[#5C6C62] mt-1 capitalize">{m.map_type?.replace("_", " ")}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[#5C6C62]">{EMPTY}</p>
          )}
        </PrintSection>

        <PrintSection title="Signatures & status" show={signatureCount > 0}>
          <div
            className="grid gap-8 mt-2"
            style={{ gridTemplateColumns: `repeat(${Math.min(signatureCount, 3)}, minmax(0, 1fr))` }}
          >
            {showDoctor && (
              <div className="text-center">
                <div className="text-xs text-[#5C6C62] mb-1">Doctor</div>
                {cr?.signature ? (
                  <img src={cr.signature} alt="Doctor signature" className="h-14 mx-auto" />
                ) : (
                  <div className="h-14 border-b border-[#2D3A33]/40" />
                )}
                <div className="text-sm mt-1">{cr?.doctor_name || performerNameForRole(visit, "doctor") || EMPTY}</div>
              </div>
            )}
            {showTherapist && (
              <div className="text-center">
                <div className="text-xs text-[#5C6C62] mb-1">Therapist</div>
                {tr?.signature ? (
                  <img src={tr.signature} alt="Therapist signature" className="h-14 mx-auto" />
                ) : (
                  <div className="h-14 border-b border-[#2D3A33]/40" />
                )}
                <div className="text-sm mt-1">
                  {tr?.therapist_name || performerNameForRole(visit, "therapist") || EMPTY}
                </div>
              </div>
            )}
            {showNurse && (
              <div className="text-center">
                <div className="text-xs text-[#5C6C62] mb-1">Nurse</div>
                {tr?.signature ? (
                  <img src={tr.signature} alt="Nurse signature" className="h-14 mx-auto" />
                ) : (
                  <div className="h-14 border-b border-[#2D3A33]/40" />
                )}
                <div className="text-sm mt-1">
                  {performerNameForRole(visit, "nurse") || tr?.therapist_name || EMPTY}
                </div>
              </div>
            )}
          </div>
        </PrintSection>

        <div className="mt-12 pt-6 border-t border-[#EAE6D7] text-center text-xs text-[#5C6C62]">
          {clinicName} · Internal medical record · Confidential — not for distribution without authorization
        </div>
      </div>
    </div>
  );
}
