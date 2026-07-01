import { AlertTriangle } from "lucide-react";
import { formatConflictTime } from "@/lib/bookingConflicts";

export default function ConflictOverrideModal({ conflict, onCancel, onContinue, busy = false }) {
  const conflicts = conflict?.conflicts || [];
  const message = conflict?.message || "This staff already has another appointment during this time.";

  return (
    <div
      className="fixed inset-0 z-[60] bg-[#2D3A33]/50 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="conflict-override-modal"
    >
      <div className="bl-card max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2 text-amber-700 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display text-lg text-[#2D3A33]">Schedule conflict</h3>
            <p className="text-sm text-[#5C6C62] mt-1">{message}</p>
          </div>
        </div>
        {conflicts.length > 0 && (
          <ul className="space-y-2 max-h-48 overflow-y-auto rounded-xl border border-[#EAE6D7] divide-y divide-[#EAE6D7]" data-testid="conflict-list">
            {conflicts.map((c) => (
              <li key={c.id || `${c.scheduled_at}-${c.patient_name}`} className="px-3 py-2.5 text-sm">
                <div className="font-medium text-[#2D3A33]">{c.is_block ? (c.patient_name || "Blocked") : (c.patient_name || "—")}</div>
                <div className="text-xs text-[#5C6C62] mt-0.5">
                  {c.is_block ? "Blocked time" : (c.treatment || "—")}
                  {" · "}
                  {formatConflictTime(c)}
                  {c.status ? ` · ${c.status}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
          <button type="button" className="bl-btn-secondary" onClick={onCancel} disabled={busy} data-testid="conflict-cancel">
            Cancel
          </button>
          <button type="button" className="bl-btn-primary" onClick={onContinue} disabled={busy} data-testid="conflict-continue">
            {busy ? "Saving…" : "Continue anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
