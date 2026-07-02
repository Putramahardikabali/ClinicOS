import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import {
  WAITLIST_PRIORITIES,
  WAITLIST_SOURCES,
  WAITLIST_TIME_TYPES,
} from "@/lib/waitingList";

const EMPTY_FORM = {
  patientType: "existing",
  patient_id: "",
  patient_name: "",
  patient_phone: "",
  patient_email: "",
  new_patient_name: "",
  new_patient_phone: "",
  new_patient_email: "",
  treatment_id: "",
  treatment_name_snapshot: "",
  desired_date: "",
  preferred_time_type: "anytime",
  preferred_time: "",
  preferred_staff_id: "",
  priority: "normal",
  source: "",
  notes: "",
};

export default function WaitingListForm({
  scheduleDate,
  onSaved,
  onCancel,
  compact = false,
}) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    desired_date: scheduleDate || "",
  }));
  const [treatments, setTreatments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/treatments-catalog", { params: { active_only: true } })
      .then((r) => setTreatments(r.data || []))
      .catch(() => setTreatments([]));
    api.get("/users")
      .then((r) => setStaff((r.data || []).filter((u) => ["doctor", "therapist", "nurse", "fo"].includes(u.role))))
      .catch(() => setStaff([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadingPatients(true);
    const q = patientSearch.trim();
    const timer = setTimeout(() => {
      api.get("/patients", { params: q ? { q } : {} })
        .then((r) => { if (!cancelled) setPatients(r.data || []); })
        .catch(() => { if (!cancelled) setPatients([]); })
        .finally(() => { if (!cancelled) setLoadingPatients(false); });
    }, q ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [patientSearch]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const selectPatient = (p) => {
    setField("patient_id", p.id);
    setField("patient_name", p.full_name);
    setField("patient_phone", p.phone || "");
    setField("patient_email", p.email || "");
    setPatientSearch(p.full_name || "");
  };

  const submit = useCallback(async (duplicateOverride = false) => {
    setError("");
    setBusy(true);
    try {
      const isNew = form.patientType === "new";
      const body = {
        is_new_patient: isNew,
        patient_id: isNew ? null : form.patient_id,
        new_patient_name: isNew ? form.new_patient_name : null,
        new_patient_phone: isNew ? form.new_patient_phone : null,
        new_patient_email: isNew ? (form.new_patient_email || null) : null,
        treatment_id: form.treatment_id || null,
        treatment_name_snapshot: form.treatment_name_snapshot,
        desired_date: form.desired_date,
        preferred_time_type: form.preferred_time_type,
        preferred_time: form.preferred_time_type === "specific" ? form.preferred_time : null,
        preferred_staff_id: form.preferred_staff_id || null,
        priority: form.priority,
        source: form.source || null,
        notes: form.notes || null,
        duplicate_override: duplicateOverride,
      };
      const r = await api.post("/waiting-list", body);
      onSaved?.(r.data);
      setForm({ ...EMPTY_FORM, desired_date: scheduleDate || "" });
      setPatientSearch("");
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (detail?.code === "duplicate_waiting_list" && !duplicateOverride) {
        const ok = window.confirm(
          `${detail.message || "Duplicate entry detected."}\n\nAdd anyway?`,
        );
        if (ok) {
          setBusy(false);
          return submit(true);
        }
        setError(detail.message);
      } else {
        setError(typeof detail === "string" ? detail : detail?.message || "Could not save waiting list entry");
      }
    } finally {
      setBusy(false);
    }
  }, [form, onSaved, scheduleDate]);

  const onTreatmentChange = (value) => {
    const t = treatments.find((x) => x.id === value || x.name === value);
    setForm((f) => ({
      ...f,
      treatment_id: t?.id || "",
      treatment_name_snapshot: t?.name || value,
    }));
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"} data-testid="waiting-list-form">
      <div>
        <div className="text-[10px] uppercase text-[#A89F8B] mb-1.5">Patient type</div>
        <div className="flex gap-2">
          {[
            { key: "existing", label: "Existing patient" },
            { key: "new", label: "New patient" },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setField("patientType", opt.key)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                form.patientType === opt.key
                  ? "border-[#52796F] bg-[#EDF3EF] text-[#2C7755]"
                  : "border-[#EAE6D7] text-[#5C6C62]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {form.patientType === "existing" ? (
        <div>
          <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Search patient</label>
          <input
            className="bl-input w-full text-sm"
            placeholder="Name, phone, email, patient code"
            value={patientSearch}
            onChange={(e) => setPatientSearch(e.target.value)}
          />
          {loadingPatients && <p className="text-xs text-[#5C6C62] mt-1">Searching…</p>}
          {patients.length > 0 && (
            <div className="mt-1 max-h-32 overflow-auto border border-[#EAE6D7] rounded-lg">
              {patients.slice(0, 8).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPatient(p)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[#F8F5EC] ${
                    form.patient_id === p.id ? "bg-[#EDF3EF]" : ""
                  }`}
                >
                  <div className="font-medium text-[#2D3A33]">{p.full_name}</div>
                  <div className="text-xs text-[#5C6C62]">{p.phone || p.email || p.user_code || "—"}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Name *</label>
            <input className="bl-input w-full text-sm" value={form.new_patient_name} onChange={(e) => setField("new_patient_name", e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Contact number *</label>
            <input className="bl-input w-full text-sm" value={form.new_patient_phone} onChange={(e) => setField("new_patient_phone", e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Email</label>
            <input className="bl-input w-full text-sm" value={form.new_patient_email} onChange={(e) => setField("new_patient_email", e.target.value)} />
          </div>
        </div>
      )}

      <div>
        <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Treatment</label>
        <select className="bl-input w-full text-sm" value={form.treatment_id || form.treatment_name_snapshot} onChange={(e) => onTreatmentChange(e.target.value)}>
          <option value="">Select treatment</option>
          {treatments.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Desired date</label>
        <input type="date" className="bl-input w-full text-sm" value={form.desired_date} onChange={(e) => setField("desired_date", e.target.value)} />
      </div>

      <div>
        <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Preferred time</label>
        <select className="bl-input w-full text-sm mb-2" value={form.preferred_time_type} onChange={(e) => setField("preferred_time_type", e.target.value)}>
          {WAITLIST_TIME_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        {form.preferred_time_type === "specific" && (
          <input type="time" className="bl-input w-full text-sm" value={form.preferred_time} onChange={(e) => setField("preferred_time", e.target.value)} />
        )}
      </div>

      <div>
        <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Preferred staff</label>
        <select className="bl-input w-full text-sm" value={form.preferred_staff_id} onChange={(e) => setField("preferred_staff_id", e.target.value)}>
          <option value="">Any staff</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Priority</label>
        <div className="flex flex-wrap gap-1.5">
          {WAITLIST_PRIORITIES.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setField("priority", p.key)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                form.priority === p.key
                  ? "border-[#52796F] bg-[#EDF3EF] text-[#2C7755]"
                  : "border-[#EAE6D7] text-[#5C6C62]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Source</label>
        <select className="bl-input w-full text-sm" value={form.source} onChange={(e) => setField("source", e.target.value)}>
          {WAITLIST_SOURCES.map((s) => (
            <option key={s.key || "none"} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Notes</label>
        <textarea className="bl-input w-full text-sm min-h-[72px]" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
      </div>

      {error && <p className="text-sm text-[#B14A2C]">{error}</p>}

      <div className="flex gap-2">
        <button type="button" className="bl-btn-primary text-sm flex-1" disabled={busy} onClick={() => submit(false)}>
          {busy ? "Saving…" : "Add to waiting list"}
        </button>
        {onCancel && (
          <button type="button" className="bl-btn-ghost text-sm" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </div>
  );
}
