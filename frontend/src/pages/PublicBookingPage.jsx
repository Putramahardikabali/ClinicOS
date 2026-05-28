import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "@/lib/api";
import { logoUrl } from "@/lib/settings";
import { toast } from "sonner";
import { Sparkles, Calendar as CalendarIcon, Clock, Phone, MapPin, Check, ArrowRight, ArrowLeft } from "lucide-react";

const fmtIDR = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");

function daysFromToday(n) {
  const arr = [];
  const today = new Date(); today.setHours(0,0,0,0);
  for (let i = 0; i < n; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    arr.push(d);
  }
  return arr;
}

const toDateString = (d) => d.toISOString().slice(0, 10);

export default function PublicBookingPage() {
  const { slug } = useParams();
  const [clinic, setClinic] = useState(null);
  const [treatments, setTreatments] = useState([]);
  const [step, setStep] = useState(0); // 0:treatment 1:date+slot 2:details 3:done
  const [selTreat, setSelTreat] = useState(null);
  const [date, setDate] = useState(toDateString(new Date()));
  const [slots, setSlots] = useState([]);
  const [closedReason, setClosedReason] = useState("");
  const [selSlot, setSelSlot] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [form, setForm] = useState({ patient_name: "", patient_phone: "", patient_email: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState(null);
  const dates = useMemo(() => daysFromToday(14), []);

  useEffect(() => {
    api.get(`/public/clinics/${slug}/treatments`).then(r => {
      setClinic(r.data.clinic); setTreatments(r.data.treatments);
    }).catch(() => setError("Clinic not found or booking is disabled."));
  }, [slug]);

  useEffect(() => {
    if (step !== 1 || !selTreat) return;
    setLoadingSlots(true); setSlots([]); setSelSlot(null); setClosedReason("");
    api.get(`/public/clinics/${slug}/availability`, { params: { date, duration: selTreat.duration_min, treatment: selTreat.name } })
      .then(r => { setSlots(r.data.slots || []); setClosedReason(r.data.closed ? (r.data.closed_reason || "Clinic closed on this day") : ""); })
      .finally(() => setLoadingSlots(false));
  }, [step, date, selTreat, slug]);

  const submit = async () => {
    if (!selTreat || !selSlot) return;
    setBusy(true);
    try {
      const r = await api.post(`/public/clinics/${slug}/bookings`, {
        patient_name: form.patient_name,
        patient_phone: form.patient_phone,
        patient_email: form.patient_email,
        treatment: selTreat.name,
        duration_min: selTreat.duration_min,
        scheduled_at: selSlot.time,
        notes: form.notes,
      });
      setConfirmation(r.data); setStep(3);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to book");
    } finally { setBusy(false); }
  };

  if (error) return <div className="min-h-screen flex items-center justify-center bg-[#FDFBF7] text-[#5C6C62]" data-testid="public-booking-error">{error}</div>;
  if (!clinic) return <div className="min-h-screen flex items-center justify-center text-[#5C6C62]">Loading…</div>;

  return (
    <div className="min-h-screen bg-[#FDFBF7]" data-testid="public-booking-page">
      <header className="border-b border-[#EAE6D7] bg-white">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center gap-3">
          {clinic.logo_path ? (
            <img src={logoUrl(clinic.logo_path)} alt="logo" className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="flex-1">
            <div className="font-display text-lg text-[#2D3A33]" data-testid="clinic-name">{clinic.name}</div>
            <div className="text-xs text-[#5C6C62] flex items-center gap-3">
              {clinic.city && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {clinic.city}</span>}
              {clinic.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" /> {clinic.phone}</span>}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-8 sm:py-10">
        {step === 3 ? (
          <div className="bl-card p-8 text-center" data-testid="booking-success">
            <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ background: "#EDF3EF", color: "#52796F" }}>
              <Check className="w-7 h-7" />
            </div>
            <h2 className="font-display text-3xl text-[#2D3A33] mt-5">Booking received!</h2>
            <p className="text-[#5C6C62] mt-2">Thanks {confirmation?.patient_name}. We've received your request for <strong>{confirmation?.treatment}</strong> on <strong>{new Date(confirmation?.scheduled_at).toLocaleString()}</strong>.</p>
            <p className="text-sm text-[#5C6C62] mt-3">The clinic will confirm your appointment via WhatsApp shortly.</p>
          </div>
        ) : (
          <>
            <div className="label-eyebrow">Book your appointment</div>
            <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">In 3 quick steps.</h1>

            <div className="mt-6 flex gap-2">
              {["Treatment", "Date & time", "Your details"].map((s, i) => (
                <div key={s} className="flex-1">
                  <div className="h-1.5 rounded-full" style={{ background: i <= step ? "var(--bl-primary)" : "#EAE6D7" }} />
                  <div className="mt-1 text-xs text-[#5C6C62]">{i + 1}. {s}</div>
                </div>
              ))}
            </div>

            {step === 0 && (
              <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="treatments-list">
                {treatments.map(t => (
                  <button key={t.key} onClick={() => { setSelTreat(t); setStep(1); }} className="bl-card text-left p-5 hover:shadow-md transition" data-testid={`treatment-${t.key}`}>
                    <div className="font-display text-lg text-[#2D3A33]">{t.name}</div>
                    <div className="text-sm text-[#5C6C62] mt-1 flex items-center gap-3">
                      <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {t.duration_min} min</span>
                      <span>{fmtIDR(t.price_idr)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {step === 1 && (
              <div className="mt-7" data-testid="date-time-step">
                <button onClick={() => setStep(0)} className="text-sm text-[#5C6C62] inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Change treatment</button>
                <div className="mt-3 bl-card p-4 text-sm text-[#2D3A33] flex items-center gap-2"><CalendarIcon className="w-4 h-4 text-[#5C6C62]" /> {selTreat.name} · {selTreat.duration_min} min</div>

                <div className="mt-5 label-eyebrow">Pick a date</div>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-2" data-testid="date-strip">
                  {dates.map(d => {
                    const ds = toDateString(d);
                    const active = date === ds;
                    return (
                      <button key={ds} onClick={() => setDate(ds)} className="shrink-0 rounded-2xl px-3 py-2 border text-center w-16" style={active ? { borderColor: "var(--bl-primary)", background: "#EDF3EF", color: "#2D3A33" } : { borderColor: "#EAE6D7", color: "#5C6C62", background: "white" }} data-testid={`date-${ds}`}>
                        <div className="text-[10px] uppercase tracking-wider">{d.toLocaleDateString("en-US", { weekday: "short" })}</div>
                        <div className="font-display text-lg">{d.getDate()}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 label-eyebrow">Available time slots</div>
                {loadingSlots ? (
                  <div className="text-sm text-[#5C6C62] mt-3">Loading slots…</div>
                ) : closedReason ? (
                  <div className="mt-3 bl-card p-4 text-sm text-[#5C6C62] bg-[#F8F5EC]" data-testid="closed-banner">
                    🚫 {closedReason}. Please pick another date.
                  </div>
                ) : (() => {
                  const visibleSlots = slots.filter(s => !s.past);
                  if (visibleSlots.length === 0) {
                    return <div className="text-sm text-[#5C6C62] mt-3">No remaining slots for this day. Please pick another date.</div>;
                  }
                  // Group by hour
                  const groups = [];
                  let currentHour = null;
                  let bucket = null;
                  for (const s of visibleSlots) {
                    const h = s.label.slice(0, 2);
                    if (h !== currentHour) {
                      currentHour = h;
                      bucket = { hour: h, items: [] };
                      groups.push(bucket);
                    }
                    bucket.items.push(s);
                  }
                  const totalAvail = visibleSlots.filter(s => s.available).length;
                  return (
                    <div className="mt-2" data-testid="slots-grid">
                      <div className="text-xs text-[#5C6C62] mb-3">
                        {totalAvail} of {visibleSlots.length} slots available
                      </div>
                      <div className="space-y-4">
                        {groups.map(g => (
                          <div key={g.hour} data-testid={`slot-hour-${g.hour}`}>
                            <div className="flex items-center gap-3 mb-2">
                              <div className="font-mono text-xs font-semibold text-[#2D3A33] tracking-wider w-10">{g.hour}:00</div>
                              <div className="flex-1 h-px bg-[#EAE6D7]" />
                            </div>
                            <div className="flex flex-wrap gap-1.5 pl-12">
                              {g.items.map(s => {
                                const active = selSlot?.time === s.time;
                                const mins = s.label.slice(3);
                                return (
                                  <button
                                    key={s.time}
                                    disabled={!s.available}
                                    onClick={() => s.available && setSelSlot(s)}
                                    aria-label={s.label}
                                    title={s.available ? s.label : `${s.label} — fully booked`}
                                    className="rounded-md px-2.5 py-1.5 border text-xs font-medium transition min-w-[44px]"
                                    style={!s.available
                                      ? { background: "transparent", color: "#C9C3B0", borderColor: "#EAE6D7", cursor: "not-allowed", textDecoration: "line-through" }
                                      : active
                                        ? { borderColor: "var(--bl-primary)", background: "var(--bl-primary)", color: "white" }
                                        : { borderColor: "#D6D0BD", color: "#2D3A33", background: "white" }}
                                    data-testid={`slot-${s.label}`}
                                  >
                                    :{mins}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-6 flex justify-end">
                  <button disabled={!selSlot} onClick={() => setStep(2)} className="bl-btn-primary inline-flex items-center gap-2 disabled:opacity-50" data-testid="next-to-details">Continue <ArrowRight className="w-4 h-4" /></button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mt-7" data-testid="details-step">
                <button onClick={() => setStep(1)} className="text-sm text-[#5C6C62] inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Change date / time</button>
                <div className="mt-3 bl-card p-4 text-sm text-[#2D3A33] flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1"><Sparkles className="w-4 h-4" /> {selTreat.name}</span>
                  <span className="inline-flex items-center gap-1"><CalendarIcon className="w-4 h-4 text-[#5C6C62]" /> {new Date(selSlot.time).toLocaleDateString()}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="w-4 h-4 text-[#5C6C62]" /> {selSlot.label}</span>
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label-eyebrow block mb-1.5">Full name</label>
                    <input className="bl-input" value={form.patient_name} onChange={e => setForm({...form, patient_name: e.target.value})} placeholder="Your full name" data-testid="booking-name" />
                  </div>
                  <div>
                    <label className="label-eyebrow block mb-1.5">WhatsApp / Phone</label>
                    <input className="bl-input" value={form.patient_phone} onChange={e => setForm({...form, patient_phone: e.target.value})} placeholder="0812…" data-testid="booking-phone" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label-eyebrow block mb-1.5">Email (optional)</label>
                    <input className="bl-input" type="email" value={form.patient_email} onChange={e => setForm({...form, patient_email: e.target.value})} placeholder="you@email.com" data-testid="booking-email" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="label-eyebrow block mb-1.5">Notes (optional)</label>
                    <textarea className="bl-input min-h-[80px]" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Anything we should know?" data-testid="booking-notes" />
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button disabled={busy || !form.patient_name || !form.patient_phone} onClick={submit} className="bl-btn-primary disabled:opacity-50" data-testid="booking-submit">{busy ? "Booking…" : "Confirm booking"}</button>
                </div>
              </div>
            )}
          </>
        )}

        <p className="mt-10 text-center text-xs text-[#5C6C62]">Powered by ClinicOS · <Link to="/login" className="underline">Staff login</Link></p>
      </main>
    </div>
  );
}
