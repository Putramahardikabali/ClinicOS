/**
 * Display-only loyalty tier badge from Admin Settings tiers + lifetime spend.
 * tier: { name, color, benefit } | null
 */
export default function LoyaltyBadge({ tier, size = "sm", className = "", emptyLabel = "No loyalty tier" }) {
  const base =
    size === "md"
      ? "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium"
      : "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

  if (!tier?.name) {
    return (
      <span
        className={`${base} bg-[#F3F1EB] text-[#7A8B81] border border-[#EAE6D7] ${className}`}
        data-testid="loyalty-badge-none"
      >
        {emptyLabel}
      </span>
    );
  }

  const color = tier.color || "#9CA3AF";
  return (
    <span
      className={`${base} ${className}`}
      style={{
        background: `${color}18`,
        color,
        border: `1px solid ${color}55`,
      }}
      data-testid="loyalty-badge"
      title={tier.benefit || undefined}
    >
      {tier.name}
    </span>
  );
}
