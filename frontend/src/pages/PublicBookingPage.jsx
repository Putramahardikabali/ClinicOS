import { useEffect, useMemo, useState } from "react";

import { useParams, Link, useSearchParams } from "react-router-dom";

import api from "@/lib/api";

import { logoUrl } from "@/lib/settings";

import { toast } from "sonner";

import { Sparkles, Calendar as CalendarIcon, Clock, Check, ArrowRight, ArrowLeft, Package } from "lucide-react";
import SearchInput from "@/components/ui/SearchInput";
import NationalityCombobox from "@/components/patient/NationalityCombobox";
import { PATIENT_SOURCE_OPTIONS } from "@/lib/patientProfile";
import {
  daysFromClinicToday,
  filterPublicBookingSlots,
  getClinicNowParts,
  resolveClinicTimezone,
} from "@/components/bookings/scheduleUtils";



const fmtIDR = (n) => "Rp " + Number(n).toLocaleString("id-ID");

function calcPaymentDue(paymentConfig, totalIdr) {
  if (!paymentConfig?.enable_online_booking_payment) return { amount: 0, requirement: "none" };
  const total = Math.max(0, Number(totalIdr) || 0);
  const req = paymentConfig.payment_requirement || "none";
  if (req === "full_payment") return { amount: total, requirement: "full_payment" };
  if (req === "deposit") {
    const val = Number(paymentConfig.deposit_value) || 0;
    const amount = paymentConfig.deposit_type === "percentage"
      ? Math.round(total * val / 100)
      : val;
    return { amount: Math.min(total, Math.max(0, amount)), requirement: "deposit" };
  }
  return { amount: 0, requirement: "none" };
}



function formatPublicPrice(price) {

  const n = Number(price);

  if (!price && price !== 0) return "Price on consultation";

  if (!n || n <= 0) return "Price on consultation";

  return fmtIDR(n);

}



const CATEGORY_LABELS = {

  facial: "Facial",

  injectable: "Injectable",

  laser: "Laser",

  peel: "Peel",

  body: "Body",

  consult: "Consultation",

  general: "Other",

};



const PACKAGE_TYPE_OPTIONS = [

  { key: "series_package", label: "Series Packages" },

  { key: "bundle_package", label: "Bundle Packages" },

  { key: "day_package", label: "Day Packages" },

];



function categoryLabel(category) {

  const key = (category || "general").trim();

  return CATEGORY_LABELS[key] || key || "Other";

}



function categoryTestId(category) {

  return (category || "general").toLowerCase().replace(/[^a-z0-9]+/g, "-");

}



function BookModeToggle({ bookMode, onChange }) {

  return (

    <div

      className="grid w-full max-w-md grid-cols-2 gap-1 rounded-xl border border-[#EAE6D7] bg-[#F0EDE4] p-1"

      role="tablist"

      data-testid="book-mode-toggle"

    >

      {["treatment", "package"].map(mode => {

        const active = bookMode === mode;

        const label = mode === "treatment" ? "Treatment" : "Package";

        return (

          <button

            key={mode}

            type="button"

            role="tab"

            aria-selected={active}

            onClick={() => onChange(mode)}

            className={[

              "min-h-[44px] w-full rounded-[10px] px-4 py-2.5 text-sm font-medium transition-all duration-150",

              active

                ? "bg-[var(--bl-primary)] text-white shadow-sm"

                : "bg-transparent text-[#2D3A33] hover:bg-white/80",

            ].join(" ")}

            data-testid={`book-mode-${mode}`}

          >

            {label}

          </button>

        );

      })}

    </div>

  );

}



function CatalogSearchInput({ value, onChange, placeholder, testId }) {
  return (
    <SearchInput
      className="mt-3"
      inputClassName="min-h-[44px] py-2.5"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      data-testid={testId}
    />
  );
}



function StepBackLink({ onClick, children, testId }) {

  return (

    <button

      type="button"

      onClick={onClick}

      className="group inline-flex items-center gap-2 text-sm font-medium text-[#52796F] hover:text-[#2D3A33] min-h-[44px] transition-colors"

      data-testid={testId}

    >

      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#EAE6D7] bg-white transition-colors group-hover:border-[#C5D4CB]">

        <ArrowLeft className="h-3.5 w-3.5" />

      </span>

      <span>{children}</span>

    </button>

  );

}



function formatDateStripLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    day: d.getUTCDate(),
  };
}



function matchesSearch(item, query, extraFields = []) {

  const q = (query || "").trim().toLowerCase();

  if (!q) return true;

  const parts = [

    item.name,

    item.category,

    item.sub_category,

    item.package_type,

    item.package_type_label,

    item.component_summary,

    item.description,

    ...extraFields,

  ];

  return parts.some(v => (v || "").toString().toLowerCase().includes(q));

}



export default function PublicBookingPage() {

  const { slug } = useParams();
  const [searchParams] = useSearchParams();

  const [clinic, setClinic] = useState(null);

  const [treatments, setTreatments] = useState([]);

  const [packages, setPackages] = useState([]);

  const [bookMode, setBookMode] = useState("treatment");

  const [step, setStep] = useState(0);

  const [selCategory, setSelCategory] = useState(null);

  const [selPackageType, setSelPackageType] = useState(null);

  const [selTreat, setSelTreat] = useState(null);

  const [selPackage, setSelPackage] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");

  const [date, setDate] = useState(() => getClinicNowParts().dateStr);

  const [slots, setSlots] = useState([]);

  const [closedReason, setClosedReason] = useState("");

  const [selSlot, setSelSlot] = useState(null);

  const [loadingSlots, setLoadingSlots] = useState(false);

  const [form, setForm] = useState({
    patient_name: "",
    patient_phone: "",
    patient_email: "",
    nationality: "",
    nationality_code: "",
    patient_source: "",
    source_detail: "",
    notes: "",
  });

  const [busy, setBusy] = useState(false);

  const [confirmation, setConfirmation] = useState(null);
  const [paymentConfig, setPaymentConfig] = useState(null);
  const [paymentPolling, setPaymentPolling] = useState(false);

  const [error, setError] = useState(null);
  const [bookingDisabled, setBookingDisabled] = useState(false);
  const [bookingDisabledMessage, setBookingDisabledMessage] = useState("");

  const timezone = resolveClinicTimezone(clinic);
  const clinicToday = useMemo(() => getClinicNowParts(timezone).dateStr, [timezone]);
  const dates = useMemo(() => daysFromClinicToday(timezone, 14), [timezone]);



  const selection = bookMode === "package" ? selPackage : selTreat;

  const isPackage = bookMode === "package" && !!selPackage;



  const categoryGroups = useMemo(() => {

    const map = new Map();

    for (const t of treatments) {

      const key = t.category || "general";

      if (!map.has(key)) {

        map.set(key, { key, label: categoryLabel(key), treatments: [] });

      }

      map.get(key).treatments.push(t);

    }

    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));

  }, [treatments]);



  const visibleTreatments = useMemo(() => {

    if (!selCategory) return [];

    const group = categoryGroups.find(g => g.key === selCategory);

    const list = group?.treatments || [];

    return list.filter(t => matchesSearch(t, searchQuery));

  }, [categoryGroups, selCategory, searchQuery]);



  const packagesByType = useMemo(() => {

    const map = new Map(PACKAGE_TYPE_OPTIONS.map(o => [o.key, []]));

    for (const p of packages) {

      const key = p.package_type || "series_package";

      if (!map.has(key)) map.set(key, []);

      map.get(key).push(p);

    }

    return map;

  }, [packages]);



  const visiblePackages = useMemo(() => {

    if (!selPackageType) return [];

    const list = packagesByType.get(selPackageType) || [];

    return list.filter(p => matchesSearch(p, searchQuery, [categoryLabel(p.category)]));

  }, [packagesByType, selPackageType, searchQuery]);



  const packageTypeCounts = useMemo(() => {

    return PACKAGE_TYPE_OPTIONS.map(opt => ({

      ...opt,

      count: (packagesByType.get(opt.key) || []).length,

    })).filter(opt => opt.count > 0);

  }, [packagesByType]);



  useEffect(() => {

    Promise.all([

      api.get(`/public/clinics/${slug}/treatments`),

      api.get(`/public/clinics/${slug}/packages`),

      api.get(`/public/clinics/${slug}/online-booking-payment`).catch(() => ({ data: { enable_online_booking_payment: false } })),

    ]).then(([tr, pk, pay]) => {
      const disabled = Boolean(tr.data.booking_disabled || pk.data.booking_disabled);
      const msg = tr.data.message || pk.data.message || "Online appointments are temporarily unavailable. Please contact the clinic directly.";
      setBookingDisabled(disabled);
      setBookingDisabledMessage(msg);
      setClinic(tr.data.clinic || pk.data.clinic);
      setTreatments(disabled ? [] : (tr.data.treatments || []));
      setPackages(disabled ? [] : (pk.data.packages || []));
      setPaymentConfig(pay.data || { enable_online_booking_payment: false });
      if (disabled) setError(msg);
    }).catch(() => setError("Clinic not found or appointments are disabled."));

  }, [slug]);



  useEffect(() => {
    if (!clinicToday) return;
    setDate((current) => (current < clinicToday ? clinicToday : current));
  }, [clinicToday]);



  useEffect(() => {

    if (searchParams.get("payment") !== "return" || !slug) return;

    const bid = sessionStorage.getItem(`obpay_${slug}`);

    const metaRaw = sessionStorage.getItem(`obpay_meta_${slug}`);

    if (!bid) return;

    let meta = {};

    try { meta = JSON.parse(metaRaw || "{}"); } catch { /* ignore */ }

    setStep(3);

    setPaymentPolling(true);

    let cancelled = false;

    const poll = async () => {

      try {

        const r = await api.get(`/public/clinics/${slug}/bookings/${bid}/payment-status`);

        if (cancelled) return;

        const ps = r.data.payment_status;

        if (r.data.confirmed) {

          setConfirmation({ ...meta, ...r.data, id: bid, status: "confirmed" });

          setPaymentPolling(false);

          sessionStorage.removeItem(`obpay_${slug}`);

          sessionStorage.removeItem(`obpay_meta_${slug}`);

          window.history.replaceState({}, "", window.location.pathname);

          return;

        }

        if (ps === "failed" || ps === "expired" || r.data.booking_status === "payment_failed" || r.data.booking_status === "payment_expired") {

          setConfirmation({ ...meta, ...r.data, id: bid, status: r.data.booking_status });

          setPaymentPolling(false);

          sessionStorage.removeItem(`obpay_${slug}`);

          sessionStorage.removeItem(`obpay_meta_${slug}`);

          return;

        }

        setTimeout(poll, 3000);

      } catch {

        if (!cancelled) setTimeout(poll, 4000);

      }

    };

    poll();

    return () => { cancelled = true; };

  }, [searchParams, slug]);



  useEffect(() => {

    if (step !== 1 || !selection) return;

    setLoadingSlots(true); setSlots([]); setSelSlot(null); setClosedReason("");

    const duration = selection.duration_min || 30;

    const treatmentName = selection.name;

    api.get(`/public/clinics/${slug}/availability`, {

      params: { date, duration, treatment: treatmentName },

    })

      .then(r => {
        if (r.data.booking_disabled) {
          setSlots([]);
          setClosedReason(r.data.closed_reason || r.data.message || bookingDisabledMessage);
          return;
        }
        setSlots(r.data.slots || []);
        setClosedReason(r.data.closed ? (r.data.closed_reason || "Clinic closed on this day") : "");
      })

      .finally(() => setLoadingSlots(false));

  }, [step, date, selection, slug, bookingDisabledMessage]);



  useEffect(() => {
    if (step !== 1 || loadingSlots || closedReason) return;
    const visible = filterPublicBookingSlots(slots, date, timezone);
    const selectable = visible.filter((s) => s.available);
    setSelSlot((prev) => {
      if (prev && selectable.some((s) => s.time === prev.time)) return prev;
      return selectable[0] || null;
    });
  }, [step, loadingSlots, slots, closedReason, date, timezone]);



  const resetStep1 = (mode) => {

    setBookMode(mode);

    setSelCategory(null);

    setSelPackageType(null);

    setSelTreat(null);

    setSelPackage(null);

    setSearchQuery("");

  };



  const submit = async () => {

    if (!selection || !selSlot) return;

    setBusy(true);

    try {

      const body = {

        patient_name: form.patient_name,

        patient_phone: form.patient_phone,

        patient_email: form.patient_email,

        treatment: selection.name,

        duration_min: selection.duration_min || 30,

        scheduled_at: selSlot.time,

        notes: form.notes,

        booking_type: isPackage ? "package" : "treatment",

      };

      if (form.nationality_code) {
        body.nationality_code = form.nationality_code;
        body.nationality = form.nationality;
      }
      if (form.patient_source) body.patient_source = form.patient_source;
      if (form.source_detail.trim()) body.source_detail = form.source_detail.trim();

      if (isPackage) body.package_id = selPackage.id;

      const paymentRequired = paymentConfig?.enable_online_booking_payment;

      if (paymentRequired) {

        body.success_return_url = `${window.location.origin}${window.location.pathname}?payment=return`;

        const r = await api.post(`/public/clinics/${slug}/bookings/checkout`, body);

        const booking = r.data.booking;

        const payment = r.data.payment;

        sessionStorage.setItem(`obpay_${slug}`, booking.id);

        sessionStorage.setItem(`obpay_meta_${slug}`, JSON.stringify({

          patient_name: form.patient_name,

          treatment: booking.treatment,

          scheduled_at: booking.scheduled_at,

          amount_due: payment.amount_due,

          payment_requirement: payment.payment_requirement,

        }));

        if (payment.payment_url) {

          window.location.href = payment.payment_url;

          return;

        }

        toast.error("Payment page unavailable");

        return;

      }

      const r = await api.post(`/public/clinics/${slug}/bookings`, body);

      setConfirmation(r.data);

      setStep(3);

    } catch (e) {

      toast.error(e?.response?.data?.detail || "Failed to book");

    } finally { setBusy(false); }

  };



  const bookingTotal = Number(selection?.price_idr) || 0;

  const paymentDue = calcPaymentDue(paymentConfig, bookingTotal);

  const paymentRequired = paymentConfig?.enable_online_booking_payment && paymentDue.amount > 0;



  const canConfirm = form.patient_name.trim() && form.patient_phone.trim();



  if (error) {

    return (

      <div className="min-h-screen flex items-center justify-center bg-[#FDFBF7] text-[#5C6C62]" data-testid="public-booking-error">

        {error}

      </div>

    );

  }

  if (!clinic) return <div className="min-h-screen flex items-center justify-center text-[#5C6C62]">Loading…</div>;



  const summaryTitle = isPackage ? selPackage.name : selTreat?.name;

  const summaryType = isPackage ? selPackage.package_type_label : null;



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

            {clinic.tagline ? <div className="text-xs text-[#5C6C62]">{clinic.tagline}</div> : null}

          </div>

        </div>

      </header>



      <main className="max-w-4xl mx-auto px-4 sm:px-5 py-6 sm:py-10 pb-24">

        {step === 3 ? (

          <div className="bl-card p-8 text-center" data-testid="booking-success">

            {paymentPolling ? (

              <>

                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center animate-pulse" style={{ background: "#EDF3EF", color: "#52796F" }}>

                  <Clock className="w-7 h-7" />

                </div>

                <h2 className="font-display text-3xl text-[#2D3A33] mt-5">Confirming payment…</h2>

                <p className="text-[#5C6C62] mt-2">Please wait while we verify your payment.</p>

              </>

            ) : confirmation?.status === "confirmed" || confirmation?.confirmed ? (

              <>

                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ background: "#EDF3EF", color: "#52796F" }}>

                  <Check className="w-7 h-7" />

                </div>

                <h2 className="font-display text-3xl text-[#2D3A33] mt-5">Appointment confirmed!</h2>

                <p className="text-[#5C6C62] mt-2">

                  Thanks {confirmation?.patient_name}. Your appointment for{" "}

                  <strong>{confirmation?.treatment}</strong> on{" "}

                  <strong>{new Date(confirmation?.scheduled_at).toLocaleString()}</strong> is confirmed.

                </p>

                {confirmation?.amount_paid ? (

                  <p className="text-sm text-[#5C6C62] mt-3">Payment received: {fmtIDR(confirmation.amount_paid)}</p>

                ) : null}

              </>

            ) : confirmation?.status === "payment_failed" || confirmation?.status === "payment_expired" ? (

              <>

                <h2 className="font-display text-3xl text-[#2D3A33] mt-5">Payment {confirmation?.status === "payment_expired" ? "expired" : "failed"}</h2>

                <p className="text-[#5C6C62] mt-2">

                  Your appointment for <strong>{confirmation?.treatment}</strong> was not confirmed. Please try again or contact the clinic.

                </p>

                <button type="button" onClick={() => { setStep(0); setConfirmation(null); }} className="bl-btn-primary mt-6 min-h-[44px]">

                  Schedule again

                </button>

              </>

            ) : (

              <>

                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center" style={{ background: "#EDF3EF", color: "#52796F" }}>

                  <Check className="w-7 h-7" />

                </div>

                <h2 className="font-display text-3xl text-[#2D3A33] mt-5">Appointment received!</h2>

                <p className="text-[#5C6C62] mt-2">

                  Thanks {confirmation?.patient_name}. We've received your request for{" "}

                  <strong>{confirmation?.treatment}</strong> on{" "}

                  <strong>{new Date(confirmation?.scheduled_at).toLocaleString()}</strong>.

                </p>

                <p className="text-sm text-[#5C6C62] mt-3">The clinic will confirm your appointment via WhatsApp shortly.</p>

              </>

            )}

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

              <div className="mt-7" data-testid="step-1-catalog">

                <BookModeToggle bookMode={bookMode} onChange={resetStep1} />



                <p className="text-sm text-[#5C6C62] mt-4">Choose a treatment or package to get started.</p>



                {bookMode === "treatment" && !selCategory && (

                  <div className="mt-5" data-testid="category-list">

                    <div className="label-eyebrow">Choose a category</div>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">

                      {categoryGroups.map(group => (

                        <button

                          key={group.key}

                          type="button"

                          onClick={() => { setSelCategory(group.key); setSelTreat(null); setSearchQuery(""); }}

                          className="bl-card text-left p-5 min-h-[72px] hover:shadow-md transition"

                          data-testid={`category-${categoryTestId(group.key)}`}

                        >

                          <div className="font-display text-lg text-[#2D3A33]">{group.label}</div>

                          <div className="text-sm text-[#5C6C62] mt-1">

                            {group.treatments.length} treatment{group.treatments.length === 1 ? "" : "s"}

                          </div>

                        </button>

                      ))}

                    </div>

                    {categoryGroups.length === 0 && (

                      <div className="mt-4 bl-card p-5 text-sm text-[#5C6C62]">No bookable treatments are available right now.</div>

                    )}

                  </div>

                )}



                {bookMode === "treatment" && selCategory && (

                  <div className="mt-5" data-testid="treatments-list">

                    <StepBackLink

                      onClick={() => { setSelCategory(null); setSelTreat(null); setSearchQuery(""); }}

                      testId="change-category"

                    >

                      Back to categories

                    </StepBackLink>

                    <div className="mt-2 label-eyebrow">Choose a treatment</div>

                    <CatalogSearchInput

                      value={searchQuery}

                      onChange={e => setSearchQuery(e.target.value)}

                      placeholder="Search treatments..."

                      testId="treatment-search"

                    />

                    <div className="mt-1 text-xs text-[#5C6C62]">{categoryLabel(selCategory)}</div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">

                      {visibleTreatments.map(t => (

                        <button

                          key={t.key}

                          type="button"

                          onClick={() => { setSelTreat(t); setStep(1); }}

                          className="bl-card text-left p-5 min-h-[88px] hover:shadow-md transition"

                          data-testid={`treatment-${t.key}`}

                        >

                          <div className="font-display text-lg text-[#2D3A33]">{t.name}</div>

                          {t.sub_category && <div className="text-xs text-[#5C6C62] mt-1">{t.sub_category}</div>}

                          <div className="text-sm text-[#5C6C62] mt-2 flex flex-wrap items-center gap-3">

                            <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {t.duration_min} min</span>

                            <span>{formatPublicPrice(t.price_idr)}</span>

                          </div>

                        </button>

                      ))}

                    </div>

                    {visibleTreatments.length === 0 && (

                      <div className="mt-4 bl-card p-5 text-sm text-[#5C6C62]">

                        {searchQuery ? "No treatments match your search." : "No treatments in this category."}

                      </div>

                    )}

                  </div>

                )}



                {bookMode === "package" && !selPackageType && (

                  <div className="mt-5" data-testid="package-type-list">

                    <div className="label-eyebrow">Choose a package type</div>

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">

                      {packageTypeCounts.map(opt => (

                        <button

                          key={opt.key}

                          type="button"

                          onClick={() => { setSelPackageType(opt.key); setSelPackage(null); setSearchQuery(""); }}

                          className="bl-card text-left p-5 min-h-[72px] hover:shadow-md transition"

                          data-testid={`package-type-${opt.key}`}

                        >

                          <div className="font-display text-lg text-[#2D3A33]">{opt.label}</div>

                          <div className="text-sm text-[#5C6C62] mt-1">

                            {opt.count} package{opt.count === 1 ? "" : "s"}

                          </div>

                        </button>

                      ))}

                    </div>

                    {packageTypeCounts.length === 0 && (

                      <div className="mt-4 bl-card p-5 text-sm text-[#5C6C62]">No bookable packages are available right now.</div>

                    )}

                  </div>

                )}



                {bookMode === "package" && selPackageType && (

                  <div className="mt-5" data-testid="packages-list">

                    <StepBackLink

                      onClick={() => { setSelPackageType(null); setSelPackage(null); setSearchQuery(""); }}

                      testId="change-package-type"

                    >

                      Back to package types

                    </StepBackLink>

                    <div className="mt-2 label-eyebrow">Choose a package</div>

                    <CatalogSearchInput

                      value={searchQuery}

                      onChange={e => setSearchQuery(e.target.value)}

                      placeholder="Search packages..."

                      testId="package-search"

                    />

                    <div className="mt-1 text-xs text-[#5C6C62]">

                      {PACKAGE_TYPE_OPTIONS.find(o => o.key === selPackageType)?.label}

                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">

                      {visiblePackages.map(p => (

                        <button

                          key={p.id}

                          type="button"

                          onClick={() => { setSelPackage(p); setStep(1); }}

                          className="bl-card text-left p-5 min-h-[96px] hover:shadow-md transition"

                          data-testid={`package-${p.key || p.id}`}

                        >

                          <div className="flex items-start gap-2">

                            <Package className="w-4 h-4 text-[#5C6C62] shrink-0 mt-1" />

                            <div className="min-w-0 flex-1">

                              <div className="font-display text-lg text-[#2D3A33]">{p.name}</div>

                              <div className="text-xs text-[#5C6C62] mt-0.5">{p.package_type_label}</div>

                            </div>

                          </div>

                          {p.description && (

                            <p className="text-xs text-[#5C6C62] mt-2 line-clamp-2">{p.description}</p>

                          )}

                          {p.component_summary && (

                            <p className="text-sm text-[#2D3A33] mt-2">{p.component_summary}</p>

                          )}

                          <div className="text-sm text-[#5C6C62] mt-2 flex flex-wrap items-center gap-3">

                            {p.duration_min ? (

                              <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {p.duration_min} min</span>

                            ) : null}

                            <span>{formatPublicPrice(p.price_idr)}</span>

                          </div>

                        </button>

                      ))}

                    </div>

                    {visiblePackages.length === 0 && (

                      <div className="mt-4 bl-card p-5 text-sm text-[#5C6C62]">

                        {searchQuery ? "No packages match your search." : "No packages in this category."}

                      </div>

                    )}

                  </div>

                )}

              </div>

            )}



            {step === 1 && selection && (

              <div className="mt-7" data-testid="date-time-step">

                <button

                  type="button"

                  onClick={() => { setStep(0); setSelSlot(null); }}

                  className="text-sm text-[#5C6C62] inline-flex items-center gap-1 min-h-[44px]"

                >

                  <ArrowLeft className="w-3.5 h-3.5" /> {isPackage ? "Change package" : "Change treatment"}

                </button>

                <p className="text-sm text-[#5C6C62] mt-2">Select a date and available time.</p>

                <div className="mt-3 bl-card p-4 text-sm text-[#2D3A33]">

                  <div className="flex flex-wrap items-center gap-2">

                    {isPackage ? <Package className="w-4 h-4 text-[#5C6C62]" /> : <Sparkles className="w-4 h-4 text-[#5C6C62]" />}

                    <span className="font-medium">{selection.name}</span>

                    {isPackage && summaryType && (

                      <span className="text-xs text-[#5C6C62]">· {summaryType}</span>

                    )}

                    <span className="text-[#5C6C62]">· {selection.duration_min} min</span>

                  </div>

                </div>



                <div className="mt-5 label-eyebrow">Pick a date</div>

                <div className="mt-2 flex gap-2 overflow-x-auto pb-2" data-testid="date-strip">

                  {dates.map((ds) => {

                    const active = date === ds;
                    const { weekday, day } = formatDateStripLabel(ds);

                    return (

                      <button

                        key={ds}

                        type="button"

                        onClick={() => setDate(ds)}

                        className="shrink-0 rounded-2xl px-3 py-2 border text-center w-16 min-h-[56px]"

                        style={active

                          ? { borderColor: "var(--bl-primary)", background: "var(--bl-primary-soft)", color: "var(--bl-text)" }

                          : { borderColor: "var(--bl-border)", color: "var(--bl-muted-text)", background: "white" }}

                        data-testid={`date-${ds}`}

                      >

                        <div className="text-[10px] uppercase tracking-wider">{weekday}</div>

                        <div className="font-display text-lg">{day}</div>

                      </button>

                    );

                  })}

                </div>



                <div className="mt-5 label-eyebrow">Available time slots</div>

                {loadingSlots ? (

                  <div className="text-sm text-[#5C6C62] mt-3">Loading slots…</div>

                ) : closedReason ? (

                  <div className="mt-3 bl-card p-4 text-sm text-[#5C6C62] bg-[#F8F5EC]" data-testid="closed-banner">

                    {closedReason}. Please pick another date.

                  </div>

                ) : (() => {

                  const visibleSlots = filterPublicBookingSlots(slots, date, timezone);

                  if (visibleSlots.length === 0) {

                    const isToday = date === clinicToday;

                    return (

                      <div className="text-sm text-[#5C6C62] mt-3" data-testid="no-slots-message">

                        {isToday

                          ? "No more available times for today. Please choose another date."

                          : "No remaining slots for this day. Please pick another date."}

                      </div>

                    );

                  }

                  const totalAvail = visibleSlots.filter(s => s.available).length;

                  return (

                    <div className="mt-3" data-testid="slots-grid">

                      <div className="text-xs text-[#5C6C62] mb-1">

                        {totalAvail} of {visibleSlots.length} slots available

                      </div>

                      <p className="text-xs text-[#5C6C62] mb-3">Select a time to continue.</p>

                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">

                        {visibleSlots.map(s => {

                          const active = selSlot?.time === s.time;

                          return (

                            <button

                              key={s.time}

                              type="button"

                              disabled={!s.available}

                              onClick={() => s.available && setSelSlot(s)}

                              title={s.available ? s.label : `${s.label} — fully booked`}

                              className="rounded-md px-2 py-3 border text-xs font-medium font-mono tabular-nums transition min-h-[44px]"

                              style={!s.available

                                ? { background: "transparent", color: "#C9C3B0", borderColor: "#EAE6D7", cursor: "not-allowed", textDecoration: "line-through" }

                                : active

                                  ? { borderColor: "var(--bl-primary)", background: "var(--bl-primary)", color: "var(--bl-primary-contrast)" }

                                  : { borderColor: "#D6D0BD", color: "#2D3A33", background: "white" }}

                              data-testid={`slot-${s.label}`}

                            >

                              {s.label}

                            </button>

                          );

                        })}

                      </div>

                    </div>

                  );

                })()}



                <div className="mt-6 flex justify-end">

                  <button

                    type="button"

                    disabled={!selSlot}

                    onClick={() => setStep(2)}

                    className="bl-btn-primary inline-flex items-center gap-2 disabled:opacity-50 min-h-[44px] px-5"

                    data-testid="next-to-details"

                  >

                    Continue <ArrowRight className="w-4 h-4" />

                  </button>

                </div>

              </div>

            )}



            {step === 2 && selection && selSlot && (

              <div className="mt-7" data-testid="details-step">

                <button

                  type="button"

                  onClick={() => setStep(1)}

                  className="text-sm text-[#5C6C62] inline-flex items-center gap-1 min-h-[44px]"

                >

                  <ArrowLeft className="w-3.5 h-3.5" /> Change date / time

                </button>



                <div className="mt-3 bl-card p-4 text-sm text-[#2D3A33]" data-testid="booking-summary">

                  <div className="label-eyebrow text-[#5C6C62] mb-2">Your appointment</div>

                  <div className="space-y-2">

                    <div className="flex flex-wrap items-center gap-2">

                      {isPackage ? <Package className="w-4 h-4 text-[#5C6C62]" /> : <Sparkles className="w-4 h-4 text-[#5C6C62]" />}

                      <span className="font-medium">{summaryTitle}</span>

                      {isPackage && summaryType && (

                        <span className="text-xs text-[#5C6C62] bl-chip">{summaryType}</span>

                      )}

                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#5C6C62]">

                      <span className="inline-flex items-center gap-1">

                        <CalendarIcon className="w-4 h-4" /> {new Date(selSlot.time).toLocaleDateString()}

                      </span>

                      <span className="inline-flex items-center gap-1">

                        <Clock className="w-4 h-4" /> {selSlot.label}

                      </span>

                      {selection.duration_min ? (

                        <span>{selection.duration_min} min</span>

                      ) : null}

                    </div>

                  </div>

                </div>



                {paymentRequired && (

                  <div className="mt-4 bl-card p-4 border border-[#52796F]/20 bg-[#EDF3EF]/40" data-testid="payment-summary">

                    <div className="label-eyebrow text-[#52796F] mb-2">Payment required</div>

                    <p className="text-sm text-[#2D3A33] font-medium">

                      {paymentDue.requirement === "deposit"

                        ? "Deposit required to secure your appointment"

                        : "Full payment required to confirm your appointment"}

                    </p>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#5C6C62]">

                      <span>Appointment total: {formatPublicPrice(bookingTotal)}</span>

                      <span className="font-medium text-[#2D3A33]">Amount due now: {fmtIDR(paymentDue.amount)}</span>

                      {paymentConfig?.payment_expiry_minutes ? (

                        <span>Complete within {paymentConfig.payment_expiry_minutes} minutes</span>

                      ) : null}

                    </div>

                  </div>

                )}



                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">

                  <div>

                    <label className="label-eyebrow block mb-1.5">Full name</label>

                    <input

                      className="bl-input min-h-[44px]"

                      value={form.patient_name}

                      onChange={e => setForm({ ...form, patient_name: e.target.value })}

                      placeholder="Your full name"

                      data-testid="booking-name"

                    />

                  </div>

                  <div>

                    <label className="label-eyebrow block mb-1.5">WhatsApp / Phone</label>

                    <input

                      className="bl-input min-h-[44px]"

                      value={form.patient_phone}

                      onChange={e => setForm({ ...form, patient_phone: e.target.value })}

                      placeholder="0812…"

                      data-testid="booking-phone"

                    />

                    <p className="text-xs text-[#5C6C62] mt-1.5">We'll use this only to confirm your appointment.</p>

                  </div>

                  <div className="sm:col-span-2">

                    <label className="label-eyebrow block mb-1.5">Email (optional)</label>

                    <input

                      className="bl-input min-h-[44px]"

                      type="email"

                      value={form.patient_email}

                      onChange={e => setForm({ ...form, patient_email: e.target.value })}

                      placeholder="you@email.com"

                      data-testid="booking-email"

                    />

                  </div>

                  <div className="sm:col-span-2">

                    <label className="label-eyebrow block mb-1.5">Nationality</label>

                    <NationalityCombobox

                      value={form.nationality_code}

                      onChange={(code, country) => setForm({

                        ...form,

                        nationality_code: code,

                        nationality: country?.name || "",

                      })}

                      placeholder="Select your nationality"

                      testId="booking-nationality"

                    />

                  </div>

                  <div className="sm:col-span-2">

                    <label className="label-eyebrow block mb-1.5">How did you hear about us?</label>

                    <select

                      className="bl-input min-h-[44px]"

                      value={form.patient_source}

                      onChange={e => setForm({ ...form, patient_source: e.target.value })}

                      data-testid="booking-patient-source"

                    >

                      {PATIENT_SOURCE_OPTIONS.map((o) => (

                        <option key={o.value || "none"} value={o.value}>{o.label}</option>

                      ))}

                    </select>

                  </div>

                  <div className="sm:col-span-2">

                    <label className="label-eyebrow block mb-1.5">Source detail</label>

                    <input

                      className="bl-input min-h-[44px]"

                      value={form.source_detail}

                      onChange={e => setForm({ ...form, source_detail: e.target.value })}

                      placeholder="Referral name, hotel, campaign, etc."

                      data-testid="booking-source-detail"

                    />

                    <p className="text-xs text-[#5C6C62] mt-1.5">

                      Add referral name, hotel name, influencer, campaign, or other detail.

                    </p>

                  </div>

                  <div className="sm:col-span-2">

                    <label className="label-eyebrow block mb-1.5">Notes (optional)</label>

                    <textarea

                      className="bl-input min-h-[80px]"

                      value={form.notes}

                      onChange={e => setForm({ ...form, notes: e.target.value })}

                      placeholder="Anything we should know?"

                      data-testid="booking-notes"

                    />

                  </div>

                </div>



                <div className="mt-6 flex flex-col items-end gap-2">

                  {!canConfirm && (

                    <p className="text-xs text-[#5C6C62] text-right" data-testid="confirm-hint">

                      Please enter your name and WhatsApp number to confirm.

                    </p>

                  )}

                  <button

                    type="button"

                    disabled={busy || !canConfirm}

                    onClick={submit}

                    className="bl-btn-primary disabled:opacity-50 min-h-[48px] px-6"

                    data-testid="booking-submit"

                  >

                    {busy ? (paymentRequired ? "Redirecting…" : "Scheduling…") : (paymentRequired ? `Pay ${fmtIDR(paymentDue.amount)} to confirm` : "Confirm appointment")}

                  </button>

                </div>

              </div>

            )}

          </>

        )}



        <p className="mt-10 text-center text-xs text-[#5C6C62]">

          Powered by ClinicOS · <Link to="/login" className="underline">Staff login</Link>

        </p>

      </main>

    </div>

  );

}

