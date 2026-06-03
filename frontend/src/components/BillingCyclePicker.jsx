import { BILLING_CYCLES } from "@/lib/billing";

export default function BillingCyclePicker({ value, onChange, className = "", fullWidth = false }) {
  return (
    <div
      className={`grid gap-1 bg-[#F3F1EB] rounded-xl p-1 ${
        fullWidth ? "grid-cols-1 sm:grid-cols-3" : "inline-flex flex-wrap w-fit max-w-full"
      } ${className}`}
      data-testid="billing-cycle-picker"
      role="tablist"
      aria-label="Billing period"
    >
      {BILLING_CYCLES.map((c) => {
        const selected = value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(c.key)}
            className={`rounded-lg text-sm transition text-left sm:text-center ${
              fullWidth ? "px-4 py-3" : "px-4 py-1.5 whitespace-nowrap"
            }`}
            style={
              selected
                ? {
                    background: "white",
                    color: "#2D3A33",
                    boxShadow: "0 1px 3px rgba(45, 58, 51, 0.08)",
                  }
                : { color: "#5C6C62" }
            }
            data-testid={`billing-cycle-${c.key}`}
          >
            <span className="font-medium block">{c.label}</span>
            {fullWidth ? (
              <span className="block text-xs mt-0.5 opacity-80">
                {c.discountPercent > 0 ? `Save ${c.discountPercent}%` : "Pay monthly"}
              </span>
            ) : (
              c.discountPercent > 0 && (
                <span className="ml-1 text-xs opacity-80">−{c.discountPercent}%</span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}
