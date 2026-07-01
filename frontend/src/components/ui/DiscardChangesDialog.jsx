import { cn } from "@/lib/utils";

/**
 * Nested dialog: confirm discarding unsaved form changes.
 */
export default function DiscardChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
  zIndex = 60,
  className,
}) {
  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 bg-[#2D3A33]/50 backdrop-blur-sm flex items-center justify-center p-4",
        className,
      )}
      style={{ zIndex }}
      onClick={onKeepEditing}
      data-testid="discard-changes-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="discard-changes-title"
    >
      <div
        className="bl-card max-w-sm w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="discard-changes-title" className="font-display text-lg text-[#2D3A33]">
          Discard unsaved changes?
        </h3>
        <p className="text-sm text-[#5C6C62]">
          Your edits have not been saved. You can keep editing or discard them.
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
          <button
            type="button"
            className="bl-btn-secondary"
            onClick={onKeepEditing}
            data-testid="discard-keep-editing"
          >
            Keep editing
          </button>
          <button
            type="button"
            className="bl-btn-primary"
            onClick={onDiscard}
            data-testid="discard-confirm"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
