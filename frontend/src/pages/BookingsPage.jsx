import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useClinic } from "@/lib/clinic";
import { useSettings } from "@/lib/settings";
import { toast } from "sonner";
import {
  CalendarDays, Clock, Phone, MessageCircle, Copy, CheckCircle2, X, Plus,
  ArrowRight, MoreHorizontal, ExternalLink,
} from "lucide-react";

const STATUS_COLORS = {
  booked:      { label: "Booked",      cls: "info"    },
  confirmed:   { label: "Confirmed",   cls: "success" },
  checked_in:  { label: "Checked in",  cls: "success" },
  completed:   { label: "Completed",   cls: "success" },
  cancelled:   { label: "Cancelled",   cls: "" },
  no_show:     { label: "No show",     cls: "" },
};

const NEXT_STATUS = {
  booked: { next: "confirmed", label: "Confirm" },
  confirmed: { next: "checked_in", label: "Check in" },
  checked_in: { next: "completed", label: "Mark complete" },
};

const SCOPE_TABS = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
];

function renderTemplate(body, ctx) {
  return body
    .replaceAll("{patient_name}", ctx.patient_name || "")
    .replaceAll("{treatment}", ctx.treatment || "")
    .replaceAll("{date}", ctx.date || "")
    .replaceAll("{time}", ctx.time || "")
    .replaceAll("{clinic_name}", ctx.clinic_name || "");
}

function WaPanel({ booking, templates, clinicName, onSent, onClose }) {
  const [tplKey, setTplKey] = useState(templates[0]?.key || "");
  const tpl = templates.find(t => t.key === tplKey) || templates[0];
  const dt = booking ? new Date(booking.scheduled_at) : null;
  const ctx = {
    patient_name: booking?.patient_name,
    treatment: booking?.treatment,
    date: dt?.toLocaleDateString(),
    time: dt?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    clinic_name: clinicName,
  };
  const [body, setBody] = useState(tpl ? renderTemplate(tpl.body, ctx) : "");

  useEffect(() => {
    if (!tpl) return;
    setBody(renderTemplate(tpl.body, ctx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tplKey, booking?.id]);

  const copy = () => { navigator.clipboard.writeText(body); toast.success("Message copied"); };
  const markSent = async () => {
    await api.post(`/bookings/${booking.id}/wa-sent`, { template_key: tplKey });
    toast.success("Marked as sent");
    onSent();
  };
  const waLink = `https://wa.me/${(booking.patient_phone || "").replace(/[^0-9]/g, "")}?text=${encodeURIComponent(body)}`;

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="wa-panel">
      <div className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="label-eyebrow">WhatsApp message</div>
            <h3 className="font-display text-xl text-[#2D3A33] mt-1">{booking.patient_name}</h3>
            <div className="text-xs text-[#5C6C62] mt-0.5">{booking.patient_phone}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]" data-testid="wa-close"><X className="w-5 h-5" /></button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2" data-testid="wa-templates">
          {templates.map(t => (
            <button
              key={t.key}
              onClick={() => setTplKey(t.key)}
              className="text-left px-3 py-2 rounded-lg border text-xs font-medium"
              style={t.key === tplKey ? { borderColor: "var(--bl-primary)", background: "#EDF3EF", color: "#2D3A33" } : { borderColor: "#EAE6D7", color: "#5C6C62", background: "white" }}
              data-testid={`wa-tpl-${t.key}`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <textarea
          className="bl-input min-h-[160px] mt-3 font-mono text-sm"
          value={body}
          onChange={e => setBody(e.target.value)}
          data-testid="wa-body"
        />

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={copy} className="bl-btn-ghost inline-flex items-center justify-center gap-2 text-sm" data-testid="wa-copy">
            <Copy className="w-4 h-4" /> Copy
          </button>
          <a href={waLink} target="_blank" rel="noreferrer" onClick={markSent} className="bl-btn-primary inline-flex items-center justify-center gap-2 text-sm" data-testid="wa-open">
            <MessageCircle className="w-4 h-4" /> Open WhatsApp
          </a>
        </div>
        <button onClick={markSent} className="mt-3 w-full text-center text-sm text-[#5C6C62] underline" data-testid="wa-mark-sent">
          Mark as sent without opening
        </button>

        {(booking.wa_history || []).length > 0 && (
          <div className="mt-5 pt-4 border-t border-[#EAE6D7]" data-testid="wa-history">
            <div className="label-eyebrow">History</div>
            <ul className="mt-2 space-y-1 text-xs text-[#5C6C62]">
              {booking.wa_history.map((h, i) => (
                <li key={i}>{h.template_key} · {new Date(h.sent_at).toLocaleString()}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function NewBookingModal({ onClose, onCreated }) {
  const [treatments, setTreatments] = useState([]);
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [pSearch, setPSearch] = useState("");
  const [step, setStep] = useState("patient"); // patient -> details
  const [form, setForm] = useState({
    patient_id: "", patient_name: "", patient_phone: "", patient_email: "",
    treatment_category: "",
    treatment: "", duration_min: 30, performer_type: "therapist",
    scheduled_date: "", scheduled_time: "",
    performer_id: "",
    notes: "",
  });
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newPatient, setNewPatient] = useState(false);
  const [customTime, setCustomTime] = useState(false);
  const [availablePerformers, setAvailablePerformers] = useState(null);
  const [loadingPerformers, setLoadingPerformers] = useState(false);
  const [suggestedPerformerId, setSuggestedPerformerId] = useState(null);

  useEffect(() => {
    api.get("/treatments-catalog", { params: { active_only: true } }).then(r => setTreatments(r.data || []));
    api.get("/patients").then(r => setPatients(r.data || []));
    api.get("/users").then(r => setStaff(r.data || []));
  }, []);

  const categories = Array.from(new Set(treatments.map(t => t.category)));
  const filteredTreatments = form.treatment_category ? treatments.filter(t => t.category === form.treatment_category) : treatments;

  const selectedTreatment = treatments.find(t => t.name === form.treatment);
  const eligibleStaff = staff.filter(s => {
    if (!selectedTreatment) return false;
    const pt = selectedTreatment.performer_type;
    if (pt === "doctor") return s.role === "doctor";
    if (pt === "therapist") return s.role === "therapist";
    return ["doctor", "therapist"].includes(s.role);
  });

  // Reload slots whenever date, treatment, or performer changes
  useEffect(() => {
    if (!form.scheduled_date || !form.treatment) { setSlots([]); return; }
    setLoadingSlots(true);
    api.get("/clinics/me").then(rc => {
      const cslug = rc.data?.slug;
      const params = { date: form.scheduled_date, duration: form.duration_min, treatment: form.treatment };
      if (form.performer_id) params.performer_id = form.performer_id;
      return api.get(`/public/clinics/${cslug}/availability`, { params });
    }).then(r => setSlots(r.data?.slots || [])).finally(() => setLoadingSlots(false));
  }, [form.scheduled_date, form.treatment, form.duration_min, form.performer_id]);

  // Fetch available performers for the chosen slot (filters off-duty/on-leave/already booked)
  useEffect(() => {
    if (!form.scheduled_date || !form.treatment || !form.scheduled_time) {
      setAvailablePerformers(null);
      return;
    }
    setLoadingPerformers(true);
    api.get("/bookings/available-performers", {
      params: {
        date: form.scheduled_date,
        time: form.scheduled_time,
        duration: form.duration_min,
        treatment: form.treatment,
      },
    })
      .then(r => {
        const list = r.data?.performers || [];
        const sug = r.data?.suggested_performer_id || null;
        setAvailablePerformers(list);
        setSuggestedPerformerId(sug);
        // Auto-select suggested performer if user hasn't picked one (or current pick is now unavailable)
        setForm(f => {
          if (!sug) return { ...f, performer_id: "" };
          const currentValid = f.performer_id && list.some(p => p.id === f.performer_id);
          if (currentValid) return f;
          return { ...f, performer_id: sug };
        });
      })
      .catch(() => { setAvailablePerformers([]); setSuggestedPerformerId(null); })
      .finally(() => setLoadingPerformers(false));
  }, [form.scheduled_date, form.scheduled_time, form.treatment, form.duration_min]);

  const selectTreatment = (name) => {
    const t = treatments.find(x => x.name === name);
    setForm(f => ({ ...f, treatment: name, duration_min: t?.duration_min || 30, performer_type: t?.performer_type || "therapist", performer_id: "" }));
  };

  const selectPatient = (p) => {
    setForm(f => ({ ...f, patient_id: p.id, patient_name: p.full_name, patient_phone: p.phone || "", patient_email: p.email || "" }));
    setNewPatient(false);
    setStep("details");
  };

  const startNewPatient = () => {
    setForm(f => ({ ...f, patient_id: "", patient_name: "", patient_phone: "", patient_email: "" }));
    setNewPatient(true);
    setStep("details");
  };

  const submit = async () => {
    if (!form.scheduled_date || !form.scheduled_time) { toast.error("Pick a date and time"); return; }
    setBusy(true);
    try {
      // Combine date + time into ISO with seconds
      const scheduled_at = `${form.scheduled_date}T${form.scheduled_time}:00`;
      await api.post("/bookings", {
        patient_id: form.patient_id || null,
        patient_name: form.patient_name,
        patient_phone: form.patient_phone,
        patient_email: form.patient_email,
        treatment: form.treatment,
        duration_min: form.duration_min,
        scheduled_at,
        performer_id: form.performer_id || null,
        notes: form.notes,
      });
      toast.success("Booking created");
      onCreated();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to create");
    } finally { setBusy(false); }
  };

  const fSearch = pSearch.toLowerCase();
  const visiblePatients = patients.filter(p =>
    !fSearch ||
    (p.full_name || "").toLowerCase().includes(fSearch) ||
    (p.phone || "").includes(fSearch) ||
    (p.email || "").toLowerCase().includes(fSearch)
  ).slice(0, 40);

  return (
    <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" data-testid="new-booking-modal">
      <div className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-[#2D3A33]">New booking</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB]"><X className="w-5 h-5" /></button>
        </div>

        {step === "patient" && (
          <div className="mt-5" data-testid="nb-step-patient">
            <label className="label-eyebrow block mb-1.5">Select patient</label>
            <input className="bl-input" placeholder="Search by name, phone, or email…" value={pSearch} onChange={e => setPSearch(e.target.value)} data-testid="nb-patient-search" />
            <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-[#EAE6D7]" data-testid="nb-patient-list">
              {visiblePatients.length === 0 && <div className="text-sm text-[#5C6C62] py-6 text-center">No matches.</div>}
              {visiblePatients.map(p => (
                <button key={p.id} onClick={() => selectPatient(p)} className="w-full text-left px-4 py-2.5 border-b border-[#EAE6D7] last:border-b-0 hover:bg-[#F8F5EC]" data-testid={`nb-patient-${p.id}`}>
                  <div className="font-medium text-[#2D3A33]">{p.full_name}</div>
                  <div className="text-xs text-[#5C6C62]">{p.phone || "—"} {p.email && `· ${p.email}`}</div>
                </button>
              ))}
            </div>
            <button onClick={startNewPatient} className="mt-3 w-full bl-btn-ghost text-sm" data-testid="nb-walk-in">+ Walk-in / new patient</button>
          </div>
        )}

        {step === "details" && (
          <div className="mt-5 space-y-4" data-testid="nb-step-details">
            <button onClick={() => setStep("patient")} className="text-xs text-[#5C6C62] hover:text-[#2D3A33]">← Change patient</button>
            <div className="bl-card p-3 text-sm flex items-center justify-between">
              <div>
                <div className="font-medium text-[#2D3A33]">{form.patient_name || "Walk-in"}</div>
                <div className="text-xs text-[#5C6C62]">{form.patient_phone || "—"}</div>
              </div>
              {newPatient && <span className="bl-chip">new</span>}
            </div>

            {newPatient && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-eyebrow block mb-1.5">Name</label>
                  <input className="bl-input" value={form.patient_name} onChange={e => setForm({...form, patient_name: e.target.value})} required data-testid="nb-patient-name" />
                </div>
                <div>
                  <label className="label-eyebrow block mb-1.5">Phone</label>
                  <input className="bl-input" value={form.patient_phone} onChange={e => setForm({...form, patient_phone: e.target.value})} required data-testid="nb-patient-phone" />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Treatment category</label>
                <select className="bl-input" value={form.treatment_category} onChange={e => setForm({...form, treatment_category: e.target.value, treatment: "", performer_id: ""})} data-testid="nb-category">
                  <option value="">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label-eyebrow block mb-1.5">Treatment</label>
                <select className="bl-input" value={form.treatment} onChange={e => selectTreatment(e.target.value)} required data-testid="nb-treatment">
                  <option value="">Pick a treatment…</option>
                  {filteredTreatments.map(t => <option key={t.id} value={t.name}>{t.name} · {t.duration_min}min</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-eyebrow block mb-1.5">Date</label>
                <input type="date" className="bl-input" value={form.scheduled_date} onChange={e => setForm({...form, scheduled_date: e.target.value})} required data-testid="nb-date" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label-eyebrow">Time</label>
                  <button
                    type="button"
                    onClick={() => { setCustomTime(v => !v); setForm(f => ({ ...f, scheduled_time: "" })); }}
                    className="text-xs underline text-[#5C6C62] hover:text-[#2D3A33]"
                    data-testid="nb-custom-time-toggle"
                  >
                    {customTime ? "Use clinic slots" : "Custom time"}
                  </button>
                </div>
                {customTime ? (
                  <input
                    type="time"
                    step="60"
                    className="bl-input"
                    value={form.scheduled_time}
                    onChange={e => setForm({ ...form, scheduled_time: e.target.value })}
                    disabled={!form.treatment || !form.scheduled_date}
                    required
                    data-testid="nb-time-custom"
                  />
                ) : (
                  <select className="bl-input" value={form.scheduled_time} onChange={e => setForm({...form, scheduled_time: e.target.value})} disabled={!form.treatment || !form.scheduled_date} required data-testid="nb-time">
                    <option value="">{loadingSlots ? "Loading slots…" : (form.treatment && form.scheduled_date ? "Pick a time…" : "Pick treatment & date first")}</option>
                    {slots.filter(s => !s.past).map(s => (
                      <option key={s.time} value={s.label} disabled={!s.available}>{s.label} {s.available ? "" : "— booked"}</option>
                    ))}
                  </select>
                )}
                {customTime && (
                  <p className="text-xs text-[#A89F8B] mt-1">Performer availability is still enforced on save.</p>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label-eyebrow">
                  Performer
                  {selectedTreatment && <span className="text-[#A89F8B] normal-case ml-1">· {selectedTreatment.performer_type}</span>}
                </label>
                {(() => {
                  const slotChosen = !!(form.scheduled_date && form.scheduled_time);
                  if (!slotChosen || !suggestedPerformerId || loadingPerformers) return null;
                  const sug = availablePerformers?.find(p => p.id === suggestedPerformerId);
                  if (!sug) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, performer_id: suggestedPerformerId }))}
                      className="text-xs underline text-[#52796F] hover:text-[#2D3A33] flex items-center gap-1"
                      data-testid="nb-autopick"
                      title={`Least-busy ${sug.role} today (${sug.bookings_today} booking${sug.bookings_today === 1 ? "" : "s"})`}
                    >
                      ✨ Auto-pick {sug.name}
                    </button>
                  );
                })()}
              </div>
              {(() => {
                const slotChosen = !!(form.scheduled_date && form.scheduled_time);
                const list = slotChosen && availablePerformers !== null
                  ? eligibleStaff.filter(s => availablePerformers.some(ap => ap.id === s.id))
                  : eligibleStaff;
                const disabled = !form.treatment || !slotChosen || loadingPerformers;
                const hint = !form.treatment
                  ? "Pick a treatment first"
                  : !slotChosen
                    ? "Pick date & time first"
                    : loadingPerformers
                      ? "Checking availability…"
                      : (list.length === 0
                          ? `No ${selectedTreatment?.performer_type || "performer"} available at this slot`
                          : null);
                return (
                  <>
                    <select
                      className="bl-input"
                      value={form.performer_id}
                      onChange={e => setForm({ ...form, performer_id: e.target.value })}
                      disabled={disabled}
                      required={list.length > 0}
                      data-testid="nb-performer"
                    >
                      {list.length === 0 && <option value="">— No performer available —</option>}
                      {list.map(s => {
                        const ap = availablePerformers?.find(p => p.id === s.id);
                        const load = ap?.bookings_today ?? 0;
                        const isSuggested = s.id === suggestedPerformerId;
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.role}){isSuggested ? " ✨" : ""} · {load} today
                          </option>
                        );
                      })}
                    </select>
                    {hint && (
                      <div className="text-xs mt-1.5" style={{ color: list.length === 0 && slotChosen ? "#B14A2C" : "#A89F8B" }} data-testid="nb-performer-hint">
                        {hint}
                      </div>
                    )}
                    {slotChosen && !loadingPerformers && eligibleStaff.length > 0 && availablePerformers !== null && availablePerformers.length < eligibleStaff.length && (
                      <div className="text-[11px] text-[#A89F8B] mt-1">
                        {eligibleStaff.length - availablePerformers.length} {selectedTreatment?.performer_type || "performer"}(s) hidden — off-duty or already booked.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div>
              <label className="label-eyebrow block mb-1.5">Notes (optional)</label>
              <textarea className="bl-input min-h-[60px]" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} data-testid="nb-notes" />
            </div>

            <button onClick={submit} disabled={busy || !form.patient_name || !form.patient_phone || !form.treatment || !form.scheduled_date || !form.scheduled_time} className="bl-btn-primary w-full disabled:opacity-50" data-testid="new-booking-submit">{busy ? "Saving…" : "Create booking"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BookingsPage() {
  const { user } = useAuth();
  const { clinic } = useClinic();
  const { branding } = useSettings();
  const [scope, setScopeKey] = useState("today");
  const [statusFilter, setStatusFilter] = useState("");
  const [bookings, setBookings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [waBooking, setWaBooking] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const clinicName = branding?.clinic_name || clinic?.name || "our clinic";

  const refresh = () => {
    const params = { scope };
    if (statusFilter) params.status = statusFilter;
    api.get("/bookings", { params }).then(r => setBookings(r.data || []));
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [scope, statusFilter]);
  useEffect(() => { api.get("/wa-templates").then(r => setTemplates(r.data || [])); }, []);

  const advance = async (b) => {
    const next = NEXT_STATUS[b.status]?.next;
    if (!next) return;
    await api.put(`/bookings/${b.id}/status`, { status: next });
    toast.success(`Moved to ${next.replace("_", " ")}`);
    refresh();
  };
  const cancel = async (b) => {
    if (!window.confirm("Cancel this booking?")) return;
    await api.delete(`/bookings/${b.id}`);
    toast.success("Cancelled");
    refresh();
  };

  const publicLink = clinic ? `${window.location.origin}/book/${clinic.slug}` : "";
  const copyLink = () => { navigator.clipboard.writeText(publicLink); toast.success("Public booking link copied"); };

  const canManage = user?.role === "fo" || user?.role === "super_admin";

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="bookings-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">Front office</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Bookings</h1>
          <p className="mt-2 text-[#5C6C62]">Manage appointments and send WhatsApp reminders.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {clinic?.slug && (
            <>
              <button onClick={copyLink} className="bl-btn-ghost inline-flex items-center gap-2 text-sm" data-testid="copy-public-link"><Copy className="w-4 h-4" /> Copy booking link</button>
              <a href={`/book/${clinic.slug}`} target="_blank" rel="noreferrer" className="bl-btn-ghost inline-flex items-center gap-2 text-sm" data-testid="open-public-link"><ExternalLink className="w-4 h-4" /> View public page</a>
            </>
          )}
          {canManage && (
            <button onClick={() => setNewOpen(true)} className="bl-btn-primary inline-flex items-center gap-2" data-testid="new-booking-button"><Plus className="w-4 h-4" /> New booking</button>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-[#F3F1EB] rounded-xl p-1" data-testid="scope-tabs">
          {SCOPE_TABS.map(t => (
            <button key={t.key} onClick={() => setScopeKey(t.key)} className="px-4 py-1.5 rounded-lg text-sm font-medium" style={scope === t.key ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: "#5C6C62" }} data-testid={`scope-${t.key}`}>
              {t.label}
            </button>
          ))}
        </div>
        <select className="bl-input max-w-[200px]" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} data-testid="status-filter">
          <option value="">All statuses</option>
          {Object.entries(STATUS_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="mt-5 bl-card overflow-hidden" data-testid="bookings-table">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
              <tr>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Patient</th>
                <th className="px-5 py-3">Treatment</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-[#5C6C62]" data-testid="bookings-empty">No bookings in this view.</td></tr>
              )}
              {bookings.map(b => {
                const dt = new Date(b.scheduled_at);
                const sc = STATUS_COLORS[b.status] || { label: b.status, cls: "" };
                const next = NEXT_STATUS[b.status];
                return (
                  <tr key={b.id} className="border-t border-[#EAE6D7]" data-testid={`booking-row-${b.id}`}>
                    <td className="px-5 py-4 text-sm text-[#2D3A33] whitespace-nowrap">
                      <div className="flex items-center gap-2"><CalendarDays className="w-3.5 h-3.5 text-[#5C6C62]" /> {dt.toLocaleDateString()}</div>
                      <div className="flex items-center gap-2 mt-1 text-[#5C6C62]"><Clock className="w-3.5 h-3.5" /> {dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {b.duration_min}m</div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-medium text-[#2D3A33]">{b.patient_name}</div>
                      <div className="text-xs text-[#5C6C62] flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" /> {b.patient_phone}</div>
                    </td>
                    <td className="px-5 py-4 text-sm text-[#2D3A33]">{b.treatment}</td>
                    <td className="px-5 py-4"><span className={`bl-chip ${sc.cls}`} data-testid={`status-chip-${b.id}`}>{sc.label}</span></td>
                    <td className="px-5 py-4 text-xs uppercase tracking-wider text-[#5C6C62]">{b.source}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 justify-end flex-wrap">
                        <button onClick={() => setWaBooking(b)} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#EAE6D7] hover:bg-[#F3F1EB]" data-testid={`wa-button-${b.id}`}>
                          <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                        </button>
                        {canManage && next && (
                          <button onClick={() => advance(b)} className="text-xs inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-white" style={{ background: "var(--bl-primary)" }} data-testid={`advance-${b.id}`}>
                            {next.label} <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canManage && b.status !== "cancelled" && b.status !== "completed" && (
                          <button onClick={() => cancel(b)} className="text-xs text-[#B14A2C] hover:underline" data-testid={`cancel-${b.id}`}>Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {waBooking && <WaPanel booking={waBooking} templates={templates} clinicName={clinicName} onClose={() => setWaBooking(null)} onSent={() => { setWaBooking(null); refresh(); }} />}
      {newOpen && <NewBookingModal onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); refresh(); }} />}
    </div>
  );
}
