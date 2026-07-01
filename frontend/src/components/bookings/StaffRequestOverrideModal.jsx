import { Heart } from "lucide-react";

export default function StaffRequestOverrideModal({
  open,
  staffName,
  message,
  busy = false,
  onCancel,
  onContinue,
}) {
  if (!open) return null;

  const copy = message || (staffName
    ? `This patient requested ${staffName}. Are you sure you want to move this appointment to another staff?`
    : "This patient requested a specific provider. Are you sure you want to move this appointment to another staff?");

  return (
    <div
      className="fixed inset-0 z-[140] bg-[#2D3A33]/50 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="staff-request-override-modal"
      onClick={() => { if (!busy) onCancel?.(); }}
    >
      <div className="bl-card max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-rose-100 p-2 text-rose-700 shrink-0">
            <Heart className="w-5 h-5 fill-current" />
          </div>
          <div>
            <h3 className="font-display text-lg text-[#2D3A33]">Patient staff request</h3>
            <p className="text-sm text-[#5C6C62] mt-1">{copy}</p>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
          <button type="button" className="bl-btn-secondary" onClick={onCancel} disabled={busy} data-testid="staff-request-cancel">
            Cancel
          </button>
          <button type="button" className="bl-btn-primary" onClick={onContinue} disabled={busy} data-testid="staff-request-continue">
            {busy ? "Saving…" : "Continue anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
