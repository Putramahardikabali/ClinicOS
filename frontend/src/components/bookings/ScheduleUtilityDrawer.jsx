import { X } from "lucide-react";
import { ScheduleUtilityPanel } from "@/components/bookings/scheduleUtilityPanels";
import { UTILITY_ITEMS } from "@/components/bookings/scheduleUtilityPermissions";

export default function ScheduleUtilityDrawer({
  open,
  utilityId,
  onClose,
  scheduleDate,
  invoiceInit,
  onPaymentSuccess,
  closeGuardRef,
}) {
  if (!open || !utilityId) return null;

  const label = UTILITY_ITEMS.find((u) => u.id === utilityId)?.label || "Utility";

  const handleClose = () => {
    if (closeGuardRef?.current && closeGuardRef.current() === false) return;
    onClose?.();
  };

  return (
    <div
      className="absolute inset-0 z-[115] pointer-events-none"
      data-testid="schedule-utility-drawer-wrap"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#2D3A33]/30 pointer-events-auto"
        aria-label="Close utility panel"
        onClick={handleClose}
        data-testid="schedule-utility-drawer-backdrop"
      />
      <div
        className="absolute top-0 bottom-0 right-0 flex flex-col bg-[#FDFBF7] shadow-2xl border-l border-[#EAE6D7] pointer-events-auto"
        style={{ width: "min(560px, calc(100% - 24px))" }}
        data-testid="schedule-utility-drawer"
        role="dialog"
        aria-label={label}
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-[#5C6C62] hover:bg-[#F3F1EB] hover:text-[#2D3A33]"
          aria-label="Close"
          data-testid="schedule-utility-drawer-close"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex-1 min-h-0 overflow-hidden">
          <ScheduleUtilityPanel
            utilityId={utilityId}
            scheduleDate={scheduleDate}
            invoiceInit={invoiceInit}
            onPaymentSuccess={onPaymentSuccess}
            closeGuardRef={closeGuardRef}
          />
        </div>
      </div>
    </div>
  );
}
