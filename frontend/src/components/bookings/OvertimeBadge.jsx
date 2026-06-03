/** Small badge for overtime bookings in schedule, list, and detail views. */
export default function OvertimeBadge({ className = "" }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-[#F5E6D3] text-[#6B5344] border border-[#C4A574]/50 ${className}`}
      data-testid="overtime-badge"
    >
      Overtime
    </span>
  );
}
