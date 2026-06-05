import { useState } from "react";
import { X, Clock, User } from "lucide-react";
import { formatWorkWindows, OVERTIME_REASONS } from "@/components/bookings/scheduleUtils";

function formatEstimatedDuration(estimatedDurationMin) {
  const min = Number(estimatedDurationMin);
  if (Number.isFinite(min) && min > 0) return `${min} min`;
  return null;
}

export default function OutsideWorkingHoursModal({
  slot,
  staffMember,
  effective,
  dateLabel,
  estimatedDurationMin = null,
  serviceLabel = null,
  onClose,
  onContinue,
}) {
  const [reason, setReason] = useState(OVERTIME_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [note, setNote] = useState("");

  const performerName = staffMember?.name || "Staff";
  const workingHours = formatWorkWindows(effective);
  const startTime = slot?.scheduled_time || "—";
  const durationText = formatEstimatedDuration(estimatedDurationMin);
  const finalReason = reason === "Other" ? customReason.trim() : reason;

  const handleContinue = (e) => {
    e.preventDefault();
    if (!finalReason) return;
    if (!note.trim()) return;
    onContinue({
      reason: finalReason,
      note: note.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#2D3A33]/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      data-testid="outside-hours-modal"
    >
      <form
        onSubmit={handleContinue}
        className="bl-card max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl text-[#2D3A33]">Outside working hours</h3>
            <p className="text-sm text-[#5C6C62] mt-1">
              This slot is outside {performerName}&apos;s scheduled hours. Overtime approval is required before saving the appointment.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-[#F3F1EB] shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <dl className="text-sm space-y-3 bl-card p-3 bg-[#FAFAF7]">
          <div className="flex gap-2">
            <User className="w-4 h-4 text-[#5C6C62] shrink-0 mt-0.5" />
            <div>
              <dt className="text-xs text-[#A89F8B] uppercase tracking-wide">Assigned staff</dt>
              <dd className="font-medium text-[#2D3A33]">{performerName}</dd>
            </div>
          </div>
          <div className="flex gap-2">
            <Clock className="w-4 h-4 text-[#5C6C62] shrink-0 mt-0.5" />
            <div>
              <dt className="text-xs text-[#A89F8B] uppercase tracking-wide">Working hours ({dateLabel})</dt>
              <dd className="text-[#2D3A33]">{workingHours}</dd>
            </div>
          </div>
          <div className="pt-2 border-t border-[#EAE6D7] space-y-2">
            <div>
              <dt className="text-xs text-[#A89F8B] uppercase tracking-wide">Start time</dt>
              <dd className="font-medium text-[#2D3A33] mt-0.5">{startTime}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#A89F8B] uppercase tracking-wide">Estimated duration</dt>
              {durationText ? (
                <dd className="font-medium text-[#2D3A33] mt-0.5" data-testid="overtime-estimated-duration">
                  {durationText}
                  {serviceLabel && (
                    <span className="block text-xs font-normal text-[#5C6C62] mt-0.5">{serviceLabel}</span>
                  )}
                </dd>
              ) : (
                <dd className="text-[#2D3A33] mt-0.5" data-testid="overtime-estimated-duration-pending">
                  Based on selected treatment
                </dd>
              )}
              <dd className="text-[10px] text-[#A89F8B] mt-1">
                Appointment length follows the selected treatment.
              </dd>
            </div>
          </div>
        </dl>

        <div>
          <label className="label-eyebrow block mb-1.5">Overtime reason</label>
          <select className="bl-input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="overtime-reason">
            {OVERTIME_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {reason === "Other" && (
            <input
              className="bl-input mt-2"
              placeholder="Describe the reason…"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              required
              data-testid="overtime-reason-custom"
            />
          )}
        </div>

        <div>
          <label className="label-eyebrow block mb-1.5">Overtime note</label>
          <textarea
            className="bl-input min-h-[72px]"
            placeholder="Required — who approved, patient context, etc."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            data-testid="overtime-note"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={!finalReason || !note.trim()}
            className="bl-btn-primary flex-1 disabled:opacity-50"
            data-testid="overtime-continue"
          >
            Continue to appointment
          </button>
          <button type="button" onClick={onClose} className="bl-btn-ghost">Cancel</button>
        </div>
      </form>
    </div>
  );
}
