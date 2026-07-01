import { useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * Confirmation dialog with overlay click and ESC to cancel.
 */
export default function ConfirmActionDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  busy = false,
  destructive = false,
  testId = "confirm-action-dialog",
  zIndex = 140,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape" || busy) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancel?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-[#2D3A33]/50 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex }}
      onClick={() => { if (!busy) onCancel?.(); }}
      data-testid={testId}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="bl-card max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg text-[#2D3A33]">{title}</h3>
        {message && <p className="text-sm text-[#5C6C62]">{message}</p>}
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
          <button
            type="button"
            className="bl-btn-secondary"
            onClick={onCancel}
            disabled={busy}
            data-testid={`${testId}-cancel`}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cn("bl-btn-primary", destructive && "bg-[#B14A2C] hover:bg-[#9A3F25] border-[#B14A2C]")}
            onClick={onConfirm}
            disabled={busy}
            data-testid={`${testId}-confirm`}
          >
            {busy ? `${confirmLabel}…` : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
