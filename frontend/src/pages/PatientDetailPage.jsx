import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import api, { fileUrl } from "@/lib/api";
import { useAuth, can, hasPermission } from "@/lib/auth";
import {
  canEditBasicPatient,
  canEditConsent,
  canEditFullPatientFields,
  canViewClinicalPatientInfo,
  basicPatientPayload,
  emptyBasicPatientForm,
  fmtDate,
  fmtDay,
  fmtIDR,
  fullPatientPayload,
  formatPatientSource,
  PATIENT_SOURCE_OPTIONS,
  SOURCE_DETAIL_PLACEHOLDER,
  visibleTabs,
} from "@/lib/patientProfile";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Calendar,
  Image as ImageIcon,
  Wallet,
  Receipt,
  Award,
  Trash2,
  Pencil,
  FileText,
  Shield,
  X,
} from "lucide-react";
import PatientPackagesPanel from "@/components/patient/PatientPackagesPanel";
import PatientWalletPanel from "@/components/patient/PatientWalletPanel";
import LoyaltyBadge from "@/components/patient/LoyaltyBadge";
import ConsentStatusBadge from "@/components/consent/ConsentStatusBadge";
import NationalityCombobox from "@/components/patient/NationalityCombobox";
import WhatsgoPatientActions from "@/components/messaging/whatsgo/WhatsgoPatientActions";

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm rounded-full whitespace-nowrap transition-colors ${
        active
          ? "bg-[#2D3A33] text-white"
          : "bg-[#F3F1EB] text-[#5C6C62] hover:bg-[#EAE6D7]"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ message }) {
  return <div className="bl-card p-8 text-center text-[#5C6C62] text-sm">{message}</div>;
}

export default function PatientDetailPage() {
  const { pid } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [patient, setPatient] = useState(null);
  const [access, setAccess] = useState(null);
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);

  const [bookings, setBookings] = useState([]);
  const [visits, setVisits] = useState([]);
  const [timelineVisits, setTimelineVisits] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [consents, setConsents] = useState(null);
  const [transactions, setTransactions] = useState([]);

  const [openEdit, setOpenEdit] = useState(false);
  const [editForm, setEditForm] = useState(emptyBasicPatientForm());
  const [editBusy, setEditBusy] = useState(false);

  const [openVisit, setOpenVisit] = useState(false);
  const [vForm, setVForm] = useState({ visit_type: "doctor", assigned_to: "", chief_complaint: "" });
  const [consentForm, setConsentForm] = useState({ consent_status: "unsigned", consent_notes: "" });
  const [consentBusy, setConsentBusy] = useState(false);

  const tabs = useMemo(() => visibleTabs(access), [access]);
  const tab = searchParams.get("tab") || "overview";
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "overview";

  const setTab = (id) => setSearchParams({ tab: id }, { replace: true });

  const loadCore = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a, s, u] = await Promise.all([
        api.get(`/patients/${pid}`),
        api.get(`/patients/${pid}/profile/access`),
        api.get(`/patients/${pid}/stats`).catch(() => ({ data: null })),
        api.get("/users").catch(() => ({ data: [] })),
      ]);
      setPatient(p.data);
      setAccess(a.data);
      setStats(s.data);
      setUsers(u.data || []);
      setConsentForm({
        consent_status: p.data.consent_status || "unsigned",
        consent_notes: p.data.consent_notes || "",
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load patient");
      setPatient(null);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  const loadTabData = useCallback(async (tabId, tabAccess) => {
    if (!tabAccess) return;
    setTabLoading(true);
    try {
      if (tabId === "overview") {
        const tx = await api.get(`/patients/${pid}/transactions`).catch(() => ({ data: [] }));
        setTransactions(tx.data || []);
      }
      if (tabId === "appointments" && tabAccess.appointments) {
        const r = await api.get("/bookings", { params: { patient_id: pid, appointments_only: true } });
        setBookings(r.data || []);
      }
      if ((tabId === "visits" || tabId === "clinical_notes") && tabAccess.visits) {
        const [v, t] = await Promise.all([
          api.get("/visits", { params: { patient_id: pid } }),
          tabId === "clinical_notes" ? api.get(`/patients/${pid}/timeline`) : Promise.resolve({ data: [] }),
        ]);
        setVisits(v.data || []);
        if (tabId === "clinical_notes") setTimelineVisits(t.data || []);
      }
      if (tabId === "photos" && tabAccess.photos) {
        const r = await api.get(`/patients/${pid}/photos`);
        setPhotos(r.data || []);
      }
      if (tabId === "invoices" && tabAccess.invoices) {
        const r = await api.get("/invoices", { params: { patient_id: pid, limit: 100 } });
        setInvoices(r.data || []);
      }
      if (tabId === "consents") {
        const r = await api.get(`/patients/${pid}/consents`);
        setConsents(r.data);
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : "Could not load tab data";
      toast.error(msg);
    } finally {
      setTabLoading(false);
    }
  }, [pid]);

  useEffect(() => { loadCore(); }, [loadCore]);
  useEffect(() => {
    if (!access || !patient) return;
    loadTabData(activeTab, access);
  }, [activeTab, access, patient, loadTabData]);

  const createVisit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post("/visits", { patient_id: pid, ...vForm });
      toast.success("Treatment session created");
      setOpenVisit(false);
      nav(`/visits/${r.data.id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const deletePatient = async () => {
    if (!window.confirm(`Permanently delete "${patient.full_name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/patients/${pid}`);
      toast.success("Patient deleted");
      nav("/patients");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to delete patient");
    }
  };

  const saveConsent = async (e) => {
    e.preventDefault();
    if (!canEditConsent(user)) return;
    setConsentBusy(true);
    try {
      const r = await api.put(`/patients/${pid}`, {
        ...patient,
        consent_status: consentForm.consent_status,
        consent_notes: consentForm.consent_notes,
      });
      setPatient(r.data);
      toast.success("Consent updated");
      loadTabData("consents", access);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update consent");
    } finally {
      setConsentBusy(false);
    }
  };

  if (loading) return <div className="p-10 text-[#5C6C62]">Loading…</div>;
  if (!patient) return <div className="p-10 text-[#B14A2C]">Patient not found or access denied.</div>;

  const filteredAssignees = users.filter((u) =>
    vForm.visit_type === "doctor" ? u.role === "doctor" : u.role === "therapist",
  );

  const canEditBasic = canEditBasicPatient(user);
  const canEditFull = canEditFullPatientFields(user);
  const canViewClinical = canViewClinicalPatientInfo(user);
  const canWhatsgoSend =
    hasPermission(user, "messaging.send")
    || hasPermission(user, "messaging.manage")
    || user?.role === "super_admin"
    || user?.role === "manager";

  const openEditModal = () => {
    setEditForm(emptyBasicPatientForm(patient));
    setOpenEdit(true);
  };

  const savePatientInfo = async (e) => {
    e.preventDefault();
    if (!canEditBasic) return;
    setEditBusy(true);
    try {
      const payload = canEditFull ? fullPatientPayload(editForm) : basicPatientPayload(editForm);
      const r = await api.put(`/patients/${pid}`, payload);
      setPatient(r.data);
      setOpenEdit(false);
      toast.success("Patient info updated");
      loadCore();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not update patient");
    } finally {
      setEditBusy(false);
    }
  };

  const renderOverview = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {stats && (
          <div className="bl-card p-5" data-testid="patient-spend-summary">
            <div className="label-eyebrow mb-3 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> Summary
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-[#5C6C62]">Lifetime spend</div>
                <div className="font-display text-xl text-[#2D3A33] mt-1">{fmtIDR(stats.total_spent_idr)}</div>
              </div>
              <div>
                <div className="text-[#5C6C62]">Session records</div>
                <div className="font-medium text-[#2D3A33] mt-1">{stats.visits_total}</div>
              </div>
              <div>
                <div className="text-[#5C6C62]">Loyalty status</div>
                <div className="mt-1.5">
                  {stats.loyalty_tier ? (
                    <div>
                      <LoyaltyBadge tier={stats.loyalty_tier} size="md" />
                      {stats.loyalty_tier.benefit && (
                        <div className="text-xs text-[#5C6C62] mt-1.5 line-clamp-2">{stats.loyalty_tier.benefit}</div>
                      )}
                    </div>
                  ) : (
                    <LoyaltyBadge tier={null} size="md" />
                  )}
                </div>
              </div>
              <div>
                <div className="text-[#5C6C62]">Last session</div>
                <div className="font-medium text-[#2D3A33] mt-1">{stats.last_visit_at ? fmtDay(stats.last_visit_at) : "—"}</div>
              </div>
            </div>
          </div>
        )}

        <div className="bl-card p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="label-eyebrow">Patient info</div>
            {canEditBasic && (
              <button type="button" onClick={openEditModal} className="text-sm inline-flex items-center gap-1.5 text-[#52796F] hover:text-[#2D3A33]" data-testid="edit-patient-info-button">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div><span className="text-[#5C6C62]">DOB</span><div className="font-medium">{patient.date_of_birth || patient.dob || "—"}</div></div>
            <div><span className="text-[#5C6C62]">Gender</span><div className="font-medium capitalize">{patient.gender || "—"}</div></div>
            <div><span className="text-[#5C6C62]">Nationality</span><div className="font-medium">{patient.nationality || "—"}</div></div>
            <div><span className="text-[#5C6C62]">Patient source</span><div className="font-medium">{formatPatientSource(patient.patient_source)}</div></div>
            <div className="sm:col-span-2"><span className="text-[#5C6C62]">Source detail</span><div className="font-medium">{patient.source_detail || "—"}</div></div>
            <div className="sm:col-span-2"><span className="text-[#5C6C62]">Address</span><div className="font-medium">{patient.address || "—"}</div></div>
            <div><span className="text-[#5C6C62]">Allergies</span><div className="font-medium">{patient.allergies || "—"}</div></div>
            <div><span className="text-[#5C6C62]">Consent</span><div className="font-medium capitalize">{patient.consent_status || "unsigned"}</div></div>
            {canViewClinical && (
              <div className="sm:col-span-2"><span className="text-[#5C6C62]">Medical history</span><div className="font-medium whitespace-pre-wrap">{patient.medical_history || "—"}</div></div>
            )}
          </div>
        </div>

        {transactions.length > 0 && (
          <div className="bl-card table-card overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--bl-border)] label-eyebrow flex items-center gap-1.5">
              <Receipt className="w-3.5 h-3.5" /> Recent treatment history
            </div>
            <div className="overflow-x-auto">
              <table className="bl-data-table w-full min-w-[560px] text-sm">
                <thead className="bl-data-table-head">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Session record</th>
                    <th className="px-5 py-3 text-right">Subtotal</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 8).map((t) => (
                    <tr key={t.visit_id}>
                      <td className="px-5 py-3">{fmtDay(t.visit_date)}</td>
                      <td className="px-5 py-3 capitalize">{t.visit_type} · {t.status?.replace("_", " ")}</td>
                      <td className="px-5 py-3 text-right">{fmtIDR(t.subtotal_idr)}</td>
                      <td className="px-5 py-3 text-right"><Link to={`/visits/${t.visit_id}`} className="text-sm" style={{ color: "var(--bl-primary)" }}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        {stats && (
          <div
            className="bl-card p-5 relative overflow-hidden"
            data-testid="loyalty-card"
            style={stats.loyalty_tier
              ? { background: `linear-gradient(135deg, ${stats.loyalty_tier.color}22 0%, white 60%)`, borderColor: stats.loyalty_tier.color }
              : undefined}
          >
            <div
              className="label-eyebrow flex items-center gap-1.5"
              style={stats.loyalty_tier ? { color: stats.loyalty_tier.color } : undefined}
            >
              <Award className="w-3.5 h-3.5" /> Loyalty
            </div>
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <div className="text-[#5C6C62] text-xs">Current tier</div>
                {stats.loyalty_tier ? (
                  <div className="font-display text-2xl mt-1 tracking-wide" style={{ color: stats.loyalty_tier.color }}>
                    {stats.loyalty_tier.name}
                  </div>
                ) : (
                  <div className="mt-1.5"><LoyaltyBadge tier={null} size="md" /></div>
                )}
              </div>
              <div>
                <div className="text-[#5C6C62] text-xs">Lifetime spend</div>
                <div className="font-medium text-[#2D3A33] mt-0.5">{fmtIDR(stats.total_spent_idr)}</div>
              </div>
              {stats.loyalty_tier?.benefit && (
                <div>
                  <div className="text-[#5C6C62] text-xs">Benefits</div>
                  <div className="text-[#2D3A33] mt-0.5">{stats.loyalty_tier.benefit}</div>
                </div>
              )}
              {stats.next_tier_label && (
                <div>
                  <div className="text-[#5C6C62] text-xs">Next tier</div>
                  <div className="font-medium text-[#2D3A33] mt-0.5">{stats.next_tier_label}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );

  const renderAppointments = () => (
    <div className="space-y-3" data-testid="patient-appointments">
      {tabLoading && <Empty message="Loading appointments…" />}
      {!tabLoading && bookings.length === 0 && <Empty message="No appointments for this patient." />}
      {!tabLoading && bookings.map((b) => (
        <div key={b.id} className="bl-card p-5 flex flex-wrap items-center gap-4 justify-between">
          <div>
            <div className="font-medium text-[#2D3A33]">{b.treatment || "Appointment"}</div>
            <div className="text-sm text-[#5C6C62] mt-1 flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{fmtDate(b.scheduled_at)}</span>
              <span className="bl-chip">{b.status}</span>
            </div>
          </div>
          {b.status === "checked_in" || b.status === "booked" ? (
            <Link to="/bookings" className="bl-btn-ghost text-sm">View in schedule</Link>
          ) : null}
        </div>
      ))}
    </div>
  );

  const renderVisits = () => (
    <div className="space-y-3" data-testid="patient-visits">
      {tabLoading && <Empty message="Loading session records…" />}
      {!tabLoading && visits.length === 0 && <Empty message="No session records yet." />}
      {!tabLoading && visits.map((v) => (
        <div key={v.id} className="bl-card p-5 flex flex-wrap items-center gap-4 justify-between">
          <div>
            <div className="font-medium capitalize text-[#2D3A33]">{v.visit_type} session</div>
            <div className="text-sm text-[#5C6C62] mt-1">{v.chief_complaint || "—"}</div>
            <div className="mt-2 flex gap-2 text-xs"><span className="bl-chip">{v.status?.replace("_", " ")}</span><span>{fmtDay(v.visit_date || v.created_at)}</span></div>
          </div>
          <Link to={`/visits/${v.id}`} className="bl-btn-ghost text-sm" data-testid={`open-visit-${v.id}`}>Open session record</Link>
        </div>
      ))}
    </div>
  );

  const renderClinicalNotes = () => (
    <div className="space-y-3" data-testid="patient-clinical-notes">
      {tabLoading && <Empty message="Loading clinical notes…" />}
      {!tabLoading && timelineVisits.length === 0 && <Empty message="No clinical documentation yet." />}
      {!tabLoading && timelineVisits.map((v) => {
        const doctor = v.clinical_record;
        const therapist = v.therapist_record;
        const hasNote = doctor || therapist;
        if (!hasNote) return null;
        return (
          <div key={v.id} className="bl-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-medium text-[#2D3A33] capitalize">{v.visit_type} · {fmtDay(v.visit_date || v.created_at)}</div>
                {doctor && (
                  <div className="mt-3 text-sm">
                    <div className="label-eyebrow">Doctor note</div>
                    <div className="text-[#5C6C62] mt-1">{doctor.diagnosis || doctor.chief_complaint || "—"}</div>
                    <span className="bl-chip mt-2 inline-block">{doctor.note_status || (doctor.submitted ? "completed" : "draft")}</span>
                  </div>
                )}
                {therapist && (
                  <div className="mt-3 text-sm">
                    <div className="label-eyebrow">Treatment note</div>
                    <div className="text-[#5C6C62] mt-1">{therapist.body_concern || therapist.treatment_plan || "—"}</div>
                    <span className="bl-chip mt-2 inline-block">{therapist.note_status || (therapist.submitted ? "completed" : "draft")}</span>
                  </div>
                )}
              </div>
              <Link to={`/visits/${v.id}`} className="bl-btn-ghost text-sm">Open session record</Link>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderPhotos = () => (
    <div data-testid="patient-photos">
      {tabLoading && <Empty message="Loading photos…" />}
      {!tabLoading && photos.length === 0 && <Empty message="No before/after photos yet." />}
      {!tabLoading && photos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((ph) => (
            <div key={ph.id} className="bl-card overflow-hidden">
              <div className="aspect-[3/4] bg-[#F3F1EB]">
                <img src={fileUrl(ph.storage_path)} alt={ph.angle} className="w-full h-full object-cover" />
              </div>
              <div className="p-3 text-xs text-[#5C6C62]">
                <div className="font-medium text-[#2D3A33] capitalize">{(ph.photo_type || "photo").replace("_", " ")} · {ph.angle}</div>
                <div className="mt-1">{fmtDay(ph.created_at)}</div>
                {ph.visit_id && (
                  <Link to={`/visits/${ph.visit_id}`} className="inline-block mt-2 text-[var(--bl-primary)]">View session record</Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderInvoices = () => (
    <div className="bl-card table-card overflow-hidden" data-testid="patient-invoices">
      {tabLoading && <Empty message="Loading invoices…" />}
      {!tabLoading && invoices.length === 0 && <Empty message="No invoices for this patient." />}
      {!tabLoading && invoices.length > 0 && (
        <div className="overflow-x-auto">
          <table className="bl-data-table w-full min-w-[640px] text-sm">
            <thead className="bl-data-table-head">
              <tr>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Invoice</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">Paid</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-5 py-3">{fmtDay(inv.created_at)}</td>
                  <td className="px-5 py-3 font-medium">{inv.invoice_number || inv.id.slice(0, 8)}</td>
                  <td className="px-5 py-3"><span className={`bl-chip ${inv.payment_status === "paid" ? "success" : inv.payment_status === "partial" ? "info" : "warning"}`}>{inv.payment_status}</span></td>
                  <td className="px-5 py-3 text-right">{fmtIDR(inv.total_amount)}</td>
                  <td className="px-5 py-3 text-right">{fmtIDR(inv.amount_paid)}</td>
                  <td className="px-5 py-3 text-right">
                    {inv.visit_id ? <Link to={`/visits/${inv.visit_id}`} className="text-sm" style={{ color: "var(--bl-primary)" }}>Session record</Link> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderConsents = () => (
    <div className="grid lg:grid-cols-2 gap-6" data-testid="patient-consents">
      <div className="bl-card p-5">
        <div className="label-eyebrow mb-3 flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Current consent</div>
        <div className="text-sm space-y-2">
          <div><span className="text-[#5C6C62]">Status</span><div className="font-medium capitalize">{consents?.current?.consent_status || patient.consent_status || "unsigned"}</div></div>
          <div><span className="text-[#5C6C62]">Signed at</span><div className="font-medium">{consents?.current?.consent_signed_at ? fmtDate(consents.current.consent_signed_at) : "—"}</div></div>
          <div><span className="text-[#5C6C62]">Notes</span><div className="font-medium whitespace-pre-wrap">{consents?.current?.consent_notes || patient.consent_notes || "—"}</div></div>
        </div>
        {canEditConsent(user) && (
          <form onSubmit={saveConsent} className="mt-5 space-y-3 border-t border-[#EAE6D7] pt-5">
            <select className="bl-input text-sm" value={consentForm.consent_status} onChange={(e) => setConsentForm({ ...consentForm, consent_status: e.target.value })}>
              <option value="unsigned">Unsigned</option>
              <option value="signed">Signed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <textarea className="bl-input text-sm min-h-[80px]" placeholder="Consent notes" value={consentForm.consent_notes} onChange={(e) => setConsentForm({ ...consentForm, consent_notes: e.target.value })} />
            <button type="submit" disabled={consentBusy} className="bl-btn-primary text-sm">Save consent</button>
          </form>
        )}
      </div>
      {(consents?.forms || []).length > 0 && (
        <div className="bl-card p-5 lg:col-span-2">
          <div className="label-eyebrow mb-3">Digital consent forms</div>
          <div className="space-y-3">
            {(consents.forms || []).map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 border border-[#EAE6D7] rounded-xl p-4">
                <div>
                  <div className="font-medium text-[#2D3A33]">{f.treatment_name_snapshot}</div>
                  <div className="text-xs text-[#5C6C62] mt-1">{f.signed_at ? fmtDate(f.signed_at) : fmtDate(f.created_at)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <ConsentStatusBadge status={f.status} />
                  {f.visit_id && <Link to={`/visits/${f.visit_id}?tab=consent`} className="text-sm" style={{ color: "var(--bl-primary)" }}>View session record</Link>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bl-card p-5">
        <div className="label-eyebrow mb-3">Consent history</div>
        {(consents?.history || []).length === 0 ? (
          <p className="text-sm text-[#5C6C62]">No consent changes recorded yet.</p>
        ) : (
          <div className="space-y-3 max-h-[420px] overflow-y-auto">
            {(consents?.history || []).map((h) => (
              <div key={h.id} className="border-b border-[#EAE6D7] pb-3 last:border-0">
                <div className="text-sm font-medium capitalize">{h.action}</div>
                <div className="text-xs text-[#5C6C62] mt-1">{fmtDate(h.created_at)} · {h.user_email}</div>
                {h.reason && <div className="text-xs text-[#5C6C62] mt-1">{h.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const tabContent = {
    overview: renderOverview(),
    appointments: renderAppointments(),
    visits: renderVisits(),
    clinical_notes: renderClinicalNotes(),
    photos: renderPhotos(),
    packages: <PatientPackagesPanel patientId={pid} compact />,
    wallet: access?.wallet ? <PatientWalletPanel patientId={pid} /> : <Empty message="No access to wallet." />,
    invoices: renderInvoices(),
    consents: renderConsents(),
  };

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <Link to="/patients" className="inline-flex items-center gap-2 text-sm text-[#5C6C62] hover:text-[#2D3A33]">
        <ArrowLeft className="w-4 h-4" /> All patients
      </Link>

      <div className="mt-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Patient profile</div>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <h1 className="font-display text-4xl tracking-tight font-light text-[#2D3A33]" data-testid="patient-name">{patient.full_name}</h1>
            {stats && <LoyaltyBadge tier={stats.loyalty_tier} size="md" />}
          </div>
          <p className="mt-1 text-[#5C6C62]">
            {patient.gender ? `${patient.gender} · ` : ""}{patient.phone || "—"}{patient.email ? ` · ${patient.email}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <WhatsgoPatientActions patientId={pid} canSend={canWhatsgoSend} />
          {canEditBasic && (
            <button type="button" onClick={openEditModal} className="bl-btn-secondary inline-flex items-center gap-2" data-testid="edit-patient-button">
              <Pencil className="w-4 h-4" /> Edit patient
            </button>
          )}
          {can(user, "create_visit") && (
            <button onClick={() => setOpenVisit(true)} className="bl-btn-primary inline-flex items-center gap-2" data-testid="new-visit-button">
              <Plus className="w-4 h-4" /> New treatment session
            </button>
          )}
          {can(user, "delete_patient") && (
            <button type="button" onClick={deletePatient} className="bl-btn-ghost inline-flex items-center gap-2 text-[#B14A2C]" data-testid="delete-patient-button">
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="mt-8 flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <TabButton key={t.id} active={activeTab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </TabButton>
        ))}
      </div>

      <div className="mt-6">{tabContent[activeTab]}</div>

      {openEdit && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setOpenEdit(false)}>
          <div className="bl-card max-w-2xl w-full p-7 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="edit-patient-modal">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-[#2D3A33]">Edit patient info</h2>
              <button type="button" onClick={() => setOpenEdit(false)} className="p-2 rounded-lg hover:bg-[#F3F1EB]" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-[#5C6C62] mt-1">Update contact and demographic details for {patient.full_name}.</p>
            <form onSubmit={savePatientInfo} className="mt-6 space-y-4" data-testid="edit-patient-form">
              <div>
                <label className="label-eyebrow block mb-1">Full name</label>
                <input className="bl-input" required value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} data-testid="edit-patient-name" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-eyebrow block mb-1">Gender</label>
                  <select className="bl-input" value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label-eyebrow block mb-1">Date of birth</label>
                  <input type="date" className="bl-input" value={editForm.date_of_birth} onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label-eyebrow block mb-1">Phone</label>
                  <input className="bl-input" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1">Email</label>
                  <input className="bl-input" type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Address</label>
                <input className="bl-input" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Nationality</label>
                <NationalityCombobox
                  value={editForm.nationality_code}
                  onChange={(code, country) => setEditForm({
                    ...editForm,
                    nationality_code: code,
                    nationality: country?.name || "",
                  })}
                  testId="edit-patient-nationality"
                />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Patient source</label>
                <select className="bl-input" value={editForm.patient_source} onChange={(e) => setEditForm({ ...editForm, patient_source: e.target.value })} data-testid="edit-patient-source">
                  {PATIENT_SOURCE_OPTIONS.map((o) => (
                    <option key={o.value || "none"} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Source detail</label>
                <input className="bl-input" placeholder={SOURCE_DETAIL_PLACEHOLDER} value={editForm.source_detail} onChange={(e) => setEditForm({ ...editForm, source_detail: e.target.value })} data-testid="edit-patient-source-detail" />
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Allergies</label>
                <input className="bl-input" value={editForm.allergies} onChange={(e) => setEditForm({ ...editForm, allergies: e.target.value })} />
              </div>
              {canEditFull && (
                <>
                  <div>
                    <label className="label-eyebrow block mb-1">Medical history</label>
                    <textarea className="bl-input min-h-[80px]" value={editForm.medical_history} onChange={(e) => setEditForm({ ...editForm, medical_history: e.target.value })} />
                  </div>
                  <div>
                    <label className="label-eyebrow block mb-1">Internal notes</label>
                    <textarea className="bl-input min-h-[80px]" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
                  </div>
                </>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" className="bl-btn-primary" disabled={editBusy} data-testid="edit-patient-save">{editBusy ? "Saving…" : "Save changes"}</button>
                <button type="button" onClick={() => setOpenEdit(false)} className="bl-btn-ghost">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {openVisit && (
        <div className="fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={() => setOpenVisit(false)}>
          <div className="bl-card max-w-md w-full p-7" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-2xl text-[#2D3A33]">New treatment session</h2>
            <p className="text-sm text-[#5C6C62] mt-1">For {patient.full_name}</p>
            <form onSubmit={createVisit} className="mt-5 space-y-4" data-testid="new-visit-form">
              <div>
                <label className="label-eyebrow block mb-1">Session type</label>
                <select className="bl-input" value={vForm.visit_type} onChange={(e) => setVForm({ ...vForm, visit_type: e.target.value, assigned_to: "" })}>
                  <option value="doctor">Doctor (face / injectable)</option>
                  <option value="therapist">Therapist (body / laser / facial)</option>
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Assign to</label>
                <select className="bl-input" value={vForm.assigned_to} onChange={(e) => setVForm({ ...vForm, assigned_to: e.target.value })}>
                  <option value="">Unassigned</option>
                  {filteredAssignees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1">Chief complaint</label>
                <textarea className="bl-input min-h-[80px]" value={vForm.chief_complaint} onChange={(e) => setVForm({ ...vForm, chief_complaint: e.target.value })} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="bl-btn-primary" data-testid="visit-create-submit">Create treatment session</button>
                <button type="button" onClick={() => setOpenVisit(false)} className="bl-btn-ghost">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
