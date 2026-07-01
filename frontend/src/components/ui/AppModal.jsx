import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import DiscardChangesDialog from "@/components/ui/DiscardChangesDialog";

/**
 * Standard app modal shell: overlay click, ESC, and unsaved-change guard.
 */
export default function AppModal({
  open = true,
  onClose,
  hasUnsavedChanges = false,
  children,
  overlayClassName,
  contentClassName,
  testId,
  zIndex = 50,
  align = "bottom-sheet",
  allowOverlayClose = true,
  blockEscape = false,
}) {
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (!open) setDiscardOpen(false);
  }, [open]);

  const requestClose = useCallback(() => {
    if (!allowOverlayClose || !onClose) return;
    if (hasUnsavedChanges) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [allowOverlayClose, hasUnsavedChanges, onClose]);

  useEffect(() => {
    if (!open || blockEscape || discardOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      requestClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, blockEscape, discardOpen, requestClose]);

  if (!open) return null;

  const alignClass = align === "bottom-sheet"
    ? "items-end sm:items-center p-0 sm:p-4"
    : "items-center p-4";

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 bg-[#2D3A33]/40 backdrop-blur-sm flex justify-center",
          alignClass,
          overlayClassName,
        )}
        style={{ zIndex }}
        onClick={requestClose}
        data-testid={testId}
      >
        <div className={cn("w-full", contentClassName)} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
      <DiscardChangesDialog
        open={discardOpen}
        onKeepEditing={() => setDiscardOpen(false)}
        onDiscard={() => {
          setDiscardOpen(false);
          onClose?.();
        }}
        zIndex={zIndex + 10}
      />
    </>
  );
}
