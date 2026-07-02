import { WAITLIST_DATE_PRESETS } from "@/lib/waitingList";

export default function WaitlistDatePresetFilters({ value, onChange, className = "" }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} data-testid="waitlist-date-presets">
      {WAITLIST_DATE_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key)}
          className={`text-xs px-2.5 py-1 rounded-full border ${
            value === p.key
              ? "border-[#52796F] bg-[#EDF3EF] text-[#2C7755]"
              : "border-[#EAE6D7] text-[#5C6C62]"
          }`}
          data-testid={`waitlist-date-preset-${p.key}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
