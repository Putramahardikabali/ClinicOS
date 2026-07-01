import {
  DURATION_SOURCES,
  durationFromStartEnd,
  endTimeFromStartDuration,
  isCustomDuration,
} from "@/lib/bookingDuration";

export default function AppointmentDurationFields({
  scheduledDate,
  startTime,
  endTime,
  durationMin,
  treatmentDefaultMin,
  durationSource,
  onChange,
  disabled = false,
  testIdPrefix = "appt-dur",
}) {
  const custom = isCustomDuration(durationMin, treatmentDefaultMin);
  const fromDrag = durationSource === DURATION_SOURCES.DRAG_SELECTION;

  const setStart = (nextStart) => {
    const dur = durationFromStartEnd(nextStart, endTime, durationMin);
    onChange({
      scheduled_time: nextStart,
      duration_min: dur,
      scheduled_end_time: endTimeFromStartDuration(nextStart, dur),
      duration_source: DURATION_SOURCES.MANUAL_OVERRIDE,
      manualDurationLocked: true,
    });
  };

  const setEnd = (nextEnd) => {
    const dur = durationFromStartEnd(startTime, nextEnd, durationMin);
    onChange({
      scheduled_end_time: nextEnd,
      duration_min: dur,
      duration_source: DURATION_SOURCES.MANUAL_OVERRIDE,
      manualDurationLocked: true,
    });
  };

  const setDuration = (nextDur) => {
    const dur = Math.max(5, Number(nextDur) || 5);
    onChange({
      duration_min: dur,
      scheduled_end_time: endTimeFromStartDuration(startTime, dur),
      duration_source: DURATION_SOURCES.MANUAL_OVERRIDE,
      manualDurationLocked: true,
    });
  };

  const resetToDefault = () => {
    const def = Number(treatmentDefaultMin) || 30;
    onChange({
      duration_min: def,
      scheduled_end_time: endTimeFromStartDuration(startTime, def),
      duration_source: DURATION_SOURCES.TREATMENT_DEFAULT,
      manualDurationLocked: false,
    });
  };

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-fields`}>
      <div className="flex items-center justify-between gap-2">
        <label className="label-eyebrow">Duration</label>
        {treatmentDefaultMin != null && (
          <button
            type="button"
            className="text-xs text-[#52796F] hover:underline disabled:opacity-40"
            onClick={resetToDefault}
            disabled={disabled || !startTime || !custom}
            data-testid={`${testIdPrefix}-reset`}
          >
            Reset to treatment duration
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-[#A89F8B] block mb-1">Start</label>
          <input
            type="time"
            step="60"
            className="bl-input text-sm"
            value={startTime || ""}
            onChange={(e) => setStart(e.target.value)}
            disabled={disabled || !scheduledDate}
            data-testid={`${testIdPrefix}-start`}
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-[#A89F8B] block mb-1">End</label>
          <input
            type="time"
            step="60"
            className="bl-input text-sm"
            value={endTime || ""}
            onChange={(e) => setEnd(e.target.value)}
            disabled={disabled || !scheduledDate || !startTime}
            data-testid={`${testIdPrefix}-end`}
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide text-[#A89F8B] block mb-1">Minutes</label>
          <input
            type="number"
            min="5"
            step="5"
            className="bl-input text-sm"
            value={durationMin || ""}
            onChange={(e) => setDuration(e.target.value)}
            disabled={disabled || !scheduledDate || !startTime}
            data-testid={`${testIdPrefix}-minutes`}
          />
        </div>
      </div>
      {fromDrag && (
        <p className="text-xs text-[#52796F] bg-[#EDF3EF] rounded-lg px-3 py-2" data-testid={`${testIdPrefix}-drag-hint`}>
          Duration was selected from schedule. You can adjust it before saving.
        </p>
      )}
      {custom && treatmentDefaultMin != null && (
        <p className="text-xs text-[#A89F8B]" data-testid={`${testIdPrefix}-custom-note`}>
          Custom duration. Default for this treatment is {treatmentDefaultMin} min.
        </p>
      )}
    </div>
  );
}
