import { AlertTriangle } from "lucide-react";
import { formatScheduleTimeRange } from "@/lib/scheduleAppointmentManip";
import { formatConflictTime } from "@/lib/bookingConflicts";

export default function ScheduleMoveConfirmModal({
  pending,
  conflicts = [],
  canOverrideConflict = false,
  busy = false,
  onCancel,
  onConfirm,
}) {
  if (!pending) return null;

  const { booking, origin, proposed, meta, scheduleDate } = pending;
  const hasConflict = conflicts.length > 0;

  return (
    <div
      className="fixed inset-0 z-[130] bg-[#2D3A33]/50 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="schedule-move-confirm-modal"
      onClick={() => { if (!busy) onCancel?.(); }}
    >
      <div className="bl-card max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="font-display text-lg text-[#2D3A33]">Confirm schedule change</h3>
          <p className="text-sm text-[#5C6C62] mt-1">Review the update before saving.</p>
        </div>

        <dl className="text-sm space-y-2 rounded-xl border border-[#EAE6D7] p-3 bg-[#FAFAF7]">
          <div className="flex justify-between gap-3">
            <dt className="text-[#A89F8B]">Patient</dt>
            <dd className="font-medium text-[#2D3A33] text-right">{booking.patient_name || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#A89F8B]">Treatment</dt>
            <dd className="text-[#2D3A33] text-right">{booking.treatment || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#A89F8B]">Staff</dt>
            <dd className="text-[#2D3A33] text-right">
              {meta.staffChanged ? (
                <span>
                  <span className="line-through opacity-60">{meta.oldStaffName}</span>
                  {" → "}
                  <span className="font-medium">{meta.staffName}</span>
                </span>
              ) : (
                meta.staffName
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#A89F8B]">Time</dt>
            <dd className="text-[#2D3A33] text-right">
              <div className="text-xs text-[#A89F8B]">Was: {formatScheduleTimeRange(scheduleDate, origin.startMin, origin.durationMin)}</div>
              <div className="font-medium">New: {formatScheduleTimeRange(scheduleDate, proposed.startMin, proposed.durationMin)}</div>
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#A89F8B]">Duration</dt>
            <dd className="text-[#2D3A33] text-right">
              {meta.durationChanged ? (
                <span>
                  <span className="line-through opacity-60">{origin.durationMin} min</span>
                  {" → "}
                  <span className="font-medium">{proposed.durationMin} min</span>
                </span>
              ) : (
                `${proposed.durationMin} min`
              )}
            </dd>
          </div>
        </dl>

        {hasConflict && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2" data-testid="schedule-move-conflict">
            <div className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>This change overlaps with another appointment/block for the selected staff.</p>
            </div>
            <ul className="text-xs text-amber-900/90 space-y-1 pl-6">
              {conflicts.slice(0, 4).map((c) => (
                <li key={c.id}>
                  {c.is_block ? (c.patient_name || "Blocked") : c.patient_name}
                  {" · "}
                  {c.treatment || "—"}
                  {" · "}
                  {formatConflictTime(c)}
                </li>
              ))}
            </ul>
            {!canOverrideConflict && (
              <p className="text-xs font-medium text-amber-900">You cannot save this change while a conflict exists.</p>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
          <button type="button" className="bl-btn-secondary" onClick={onCancel} disabled={busy} data-testid="schedule-move-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="bl-btn-primary"
            onClick={onConfirm}
            disabled={busy || (hasConflict && !canOverrideConflict)}
            data-testid="schedule-move-confirm"
          >
            {busy ? "Saving…" : (hasConflict && canOverrideConflict ? "Confirm anyway" : "Confirm update")}
          </button>
        </div>
      </div>
    </div>
  );
}
