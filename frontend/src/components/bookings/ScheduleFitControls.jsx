import { useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SCHEDULE_FIT_MODES } from "@/lib/scheduleScale";

function Stepper({ label, onMinus, onPlus, testIdPrefix }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-[#EAE6D7] bg-white/90 px-1 py-0.5 text-[10px] text-[#5C6C62]">
      <span className="px-1 font-medium uppercase tracking-wide">{label}</span>
      <button
        type="button"
        className="p-1 rounded hover:bg-[#F3F1EB]"
        onClick={onMinus}
        aria-label={`Decrease ${label}`}
        data-testid={`${testIdPrefix}-minus`}
      >
        <Minus className="w-3 h-3" />
      </button>
      <button
        type="button"
        className="p-1 rounded hover:bg-[#F3F1EB]"
        onClick={onPlus}
        aria-label={`Increase ${label}`}
        data-testid={`${testIdPrefix}-plus`}
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}

export default function ScheduleFitControls({
  fitMode,
  orientation,
  onFitHeight,
  onFitWidth,
  onFitScreen,
  onReset,
  onAdjustRowH,
  onAdjustSlotPx,
  onAdjustStaffCol,
  compact = false,
}) {
  const [open, setOpen] = useState(false);
  const fitLabel = fitMode === SCHEDULE_FIT_MODES.default ? "Fit" : "Fit ·";

  if (compact) {
    return (
      <div
        className="flex flex-wrap items-center gap-1.5"
        data-testid="schedule-fit-controls-compact"
      >
        <Stepper label="H" onMinus={() => onAdjustRowH(-1)} onPlus={() => onAdjustRowH(1)} testIdPrefix="schedule-fit-height" />
        {orientation === "horizontal" ? (
          <Stepper label="W" onMinus={() => onAdjustSlotPx(-1)} onPlus={() => onAdjustSlotPx(1)} testIdPrefix="schedule-fit-width" />
        ) : (
          <Stepper label="W" onMinus={() => onAdjustStaffCol(-1)} onPlus={() => onAdjustStaffCol(1)} testIdPrefix="schedule-fit-staff-col" />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2" data-testid="schedule-fit-controls">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="bl-btn-secondary text-xs inline-flex items-center gap-1"
            data-testid="schedule-fit-menu"
          >
            {fitLabel}
            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem]">
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => { onFitHeight(); setOpen(false); }}
            data-testid="schedule-fit-height"
          >
            Fit to height
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => { onFitWidth(); setOpen(false); }}
            data-testid="schedule-fit-width"
          >
            Fit to width
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => { onFitScreen(); setOpen(false); }}
            data-testid="schedule-fit-screen"
          >
            Fit to screen
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => { onReset(); setOpen(false); }}
            data-testid="schedule-fit-reset"
          >
            Reset view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Stepper label="H" onMinus={() => onAdjustRowH(-1)} onPlus={() => onAdjustRowH(1)} testIdPrefix="schedule-fit-height-step" />
      {orientation === "horizontal" ? (
        <Stepper label="W" onMinus={() => onAdjustSlotPx(-1)} onPlus={() => onAdjustSlotPx(1)} testIdPrefix="schedule-fit-width-step" />
      ) : (
        <Stepper label="W" onMinus={() => onAdjustStaffCol(-1)} onPlus={() => onAdjustStaffCol(1)} testIdPrefix="schedule-fit-staff-col-step" />
      )}
    </div>
  );
}
