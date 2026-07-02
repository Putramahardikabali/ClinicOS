import { useEffect, useState } from "react";
import api from "@/lib/api";
import { can } from "@/lib/auth";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";
import PatientLabelsRow from "@/components/patient/PatientLabelsRow";
import PatientBlacklistBanner from "@/components/patient/PatientBlacklistBanner";
import PosSearchCombobox from "@/components/pos/PosSearchCombobox";
import { isBlacklisted } from "@/lib/patientLabelDisplay";

export default function PosCustomerBar({
  user,
  walkIn,
  onWalkInChange,
  patientQuery,
  onPatientQueryChange,
  patientOptions,
  onPatientOptionsChange,
  selectedPatient,
  onSelectPatient,
  onClearPatient,
  customerName,
  onCustomerNameChange,
  customerPhone,
  onCustomerPhoneChange,
  customerEmail,
  onCustomerEmailChange,
  searchPatients,
}) {
  const canQuickCreate = can(user, "create_patient");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickForm, setQuickForm] = useState({ full_name: "", phone: "", email: "" });

  useEffect(() => {
    if (walkIn || selectedPatient) {
      onPatientOptionsChange([]);
      return undefined;
    }
    const t = setTimeout(() => searchPatients(patientQuery), 250);
    return () => clearTimeout(t);
  }, [patientQuery, walkIn, selectedPatient, searchPatients, onPatientOptionsChange]);

  const submitQuickPatient = async (e) => {
    e.preventDefault();
    if (quickBusy) return;
    if (!quickForm.full_name.trim()) {
      toast.error("Name is required");
      return;
    }
    setQuickBusy(true);
    try {
      const r = await api.post("/patients", {
        full_name: quickForm.full_name.trim(),
        phone: quickForm.phone.trim() || undefined,
        email: quickForm.email.trim() || undefined,
      });
      onSelectPatient(r.data);
      onWalkInChange(false);
      onPatientQueryChange("");
      onPatientOptionsChange([]);
      setQuickOpen(false);
      setQuickForm({ full_name: "", phone: "", email: "" });
      toast.success("Patient created");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create patient");
    } finally {
      setQuickBusy(false);
    }
  };

  const patientSecondary = (p) => [p?.phone, p?.email].filter(Boolean).join(" · ");

  return (
    <div className="bl-card p-4 sm:p-5 overflow-visible" data-testid="pos-customer-bar">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="label-eyebrow">Customer</div>
        {canQuickCreate && !walkIn && (
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            className="bl-btn-ghost text-xs inline-flex items-center gap-1 py-1"
            data-testid="pos-quick-create-patient"
          >
            <UserPlus className="w-3.5 h-3.5" /> Quick create
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-4 mb-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={walkIn}
            onChange={(e) => onWalkInChange(e.target.checked)}
            data-testid="pos-walkin-toggle"
          />
          Walk-in
        </label>
      </div>

      {!walkIn && (
        <div className="mb-3">
          {selectedPatient ? (
            <div className="bl-input flex flex-col gap-2 py-3" data-testid="pos-selected-patient">
              <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-[#2D3A33] flex flex-wrap items-center gap-2">
                  {selectedPatient?.full_name || "Patient"}
                  <PatientLabelsRow labels={selectedPatient?.patient_labels} />
                </div>
                {patientSecondary(selectedPatient) && (
                  <div className="text-xs text-[#5C6C62] mt-0.5">{patientSecondary(selectedPatient)}</div>
                )}
              </div>
              <button
                type="button"
                className="text-xs shrink-0 text-[var(--bl-primary)] font-medium"
                onClick={() => {
                  onClearPatient();
                  onPatientQueryChange("");
                  onPatientOptionsChange([]);
                }}
              >
                Change
              </button>
              </div>
              <PatientBlacklistBanner patient={selectedPatient} />
            </div>
          ) : (
            <>
              <p className="text-xs text-[#5C6C62] mb-2" data-testid="pos-patient-helper">
                Select a patient for this POS sale.
              </p>
              <PosSearchCombobox
                value={patientQuery}
                onValueChange={(v) => {
                  onPatientQueryChange(v);
                  if (!v.trim()) onPatientOptionsChange([]);
                }}
                options={patientOptions}
                onSelect={(p) => {
                  onSelectPatient(p);
                  onPatientQueryChange("");
                  onPatientOptionsChange([]);
                }}
                getOptionKey={(p) => p.id}
                placeholder="Search patient by name, phone, email, or code…"
                listAriaLabel="Patients"
                emptyMessage="No patients found"
                testId="pos-patient-search"
                renderOption={(p) => (
                  <>
                    <div className="font-medium text-sm text-[#2D3A33] flex flex-wrap items-center gap-1.5">
                      {p?.full_name || "Patient"}
                      <PatientLabelsRow labels={p?.patient_labels} />
                    </div>
                    {patientSecondary(p) && (
                      <div className="text-xs text-[#5C6C62] mt-0.5">
                        {patientSecondary(p)}
                        {isBlacklisted(p) ? " · Blacklisted patient" : ""}
                      </div>
                    )}
                  </>
                )}
              />
            </>
          )}
        </div>
      )}

      {walkIn && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            className="bl-input"
            placeholder="Walk-in name"
            value={customerName}
            onChange={(e) => onCustomerNameChange(e.target.value)}
            data-testid="pos-walkin-name"
          />
          <input
            className="bl-input"
            placeholder="Phone"
            value={customerPhone}
            onChange={(e) => onCustomerPhoneChange(e.target.value)}
          />
          <input
            className="bl-input"
            placeholder="Email"
            value={customerEmail}
            onChange={(e) => onCustomerEmailChange(e.target.value)}
          />
        </div>
      )}

      {quickOpen && (
        <div className="fixed inset-0 z-50 bg-[#2D3A33]/40 flex items-center justify-center p-4" onClick={() => setQuickOpen(false)}>
          <div className="bl-card max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-display text-lg">Quick create patient</h3>
              <button type="button" onClick={() => setQuickOpen(false)} className="p-1"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitQuickPatient} className="space-y-3">
              <input
                className="bl-input"
                required
                placeholder="Full name"
                value={quickForm.full_name}
                onChange={(e) => setQuickForm({ ...quickForm, full_name: e.target.value })}
                data-testid="pos-quick-patient-name"
              />
              <input
                className="bl-input"
                placeholder="Phone"
                value={quickForm.phone}
                onChange={(e) => setQuickForm({ ...quickForm, phone: e.target.value })}
              />
              <input
                className="bl-input"
                type="email"
                placeholder="Email"
                value={quickForm.email}
                onChange={(e) => setQuickForm({ ...quickForm, email: e.target.value })}
              />
              <div className="flex gap-2 pt-2">
                <button type="submit" className="bl-btn-primary flex-1" disabled={quickBusy}>
                  {quickBusy ? "Saving…" : "Create & select"}
                </button>
                <button type="button" className="bl-btn-ghost" onClick={() => setQuickOpen(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
