import BillingCyclePicker from "@/components/BillingCyclePicker";
import { formatIdr } from "@/lib/clinic";
import { cycleLabel, primaryBillingActionLabel } from "@/lib/billing";
import { RefreshCw, ArrowUpRight, Calendar, Sparkles, Crown, Users, HardDrive } from "lucide-react";

const PLAN_DISPLAY = {
  starter: { label: "Starter", accent: "#5C6C62" },
  clinic: { label: "Clinic", accent: "var(--bl-primary)" },
  complete: { label: "Complete", accent: "#6B3A8A" },
  trial: { label: "Trial", accent: "var(--bl-accent)" },
};

function StatusChip({ status, days }) {
  if (status === "trial") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#FBF3DB] text-[#8A6D1F]">
        <Sparkles className="w-3 h-3" />
        Trial · {days} day{days !== 1 ? "s" : ""} left
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#FBE7DF] text-[#B14A2C]">
        Expired
      </span>
    );
  }
  if (status === "suspended") {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#FBE7DF] text-[#B14A2C]">
        Suspended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#EDF3EF] text-[#52796F]">
      Active
    </span>
  );
}

function formatStaffLimit(maxStaff) {
  const n = Number(maxStaff);
  if (!n || n >= 9999) return "Unlimited";
  return String(n);
}

function formatStorageGb(gb) {
  const n = Number(gb);
  if (!n) return null;
  return `${n} GB`;
}

function resolveUsageStats({ planDetails, usage, staffCount }) {
  const maxStaff = planDetails?.max_staff;
  const storageLimitGb = planDetails?.storage_gb;
  const staffUsed =
    usage?.staff_count ?? usage?.staff_used ?? staffCount ?? null;
  const storageUsedGb =
    usage?.storage_used_gb ?? usage?.storage_gb_used ?? null;

  const rows = [];

  if (maxStaff != null && staffUsed != null) {
    rows.push({
      key: "staff",
      icon: Users,
      label: "Staff accounts",
      value: `${staffUsed} / ${formatStaffLimit(maxStaff)}`,
    });
  }

  if (storageLimitGb != null && storageUsedGb != null) {
    const limit = formatStorageGb(storageLimitGb);
    const used =
      typeof storageUsedGb === "number"
        ? `${storageUsedGb % 1 === 0 ? storageUsedGb : storageUsedGb.toFixed(1)} GB`
        : String(storageUsedGb);
    rows.push({
      key: "storage",
      icon: HardDrive,
      label: "Storage",
      value: `${used} / ${limit}`,
    });
  }

  return rows;
}

export default function CurrentSubscriptionCard({
  sub,
  trialDays,
  currentPlan,
  currentCharge,
  billingCycle,
  onBillingCycleChange,
  onRenew,
  onSubscribe,
  onUpgrade,
  showRenew,
  showSubscribe,
  showUpgrade,
  onHighestPlan,
  planDetails,
  usage,
  staffCount,
}) {
  const planKey = sub.status === "trial" ? "trial" : sub.plan;
  const meta = PLAN_DISPLAY[planKey] || { label: sub.plan, accent: "var(--bl-primary)" };
  const usageRows = resolveUsageStats({ planDetails, usage, staffCount });
  const primaryActionLabel = primaryBillingActionLabel(sub);

  const listTotal = currentPlan && currentCharge
    ? Number(currentPlan.price_idr || 0) * currentCharge.months
    : null;
  const discountAmount =
    listTotal != null && currentCharge && currentCharge.discountPercent > 0
      ? listTotal - currentCharge.totalIdr
      : 0;

  return (
    <div
      className="mt-6 overflow-hidden rounded-2xl border border-[#EAE6D7] bg-white shadow-sm"
      data-testid="current-plan-badge"
    >
      <div
        className="px-5 sm:px-6 py-5 sm:py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        style={{ background: "linear-gradient(135deg, #F8F5EC 0%, #FFFFFF 55%)" }}
      >
        <div className="flex items-start gap-4 min-w-0">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "#EDF3EF", color: meta.accent }}
          >
            <Crown className="w-6 h-6" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="label-eyebrow">Your subscription</div>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <h2 className="font-display text-2xl sm:text-3xl text-[#2D3A33] capitalize" data-testid="current-plan-name">
                {meta.label}
              </h2>
              <StatusChip status={sub.status} days={trialDays} />
            </div>
            {sub.status === "expired" && (
              <p className="mt-1.5 text-sm text-[#B14A2C]" data-testid="current-plan-status">
                Read-only until you renew
              </p>
            )}
          </div>
        </div>
      </div>

      {(usageRows.length > 0 || sub.billing_cycle || sub.expiry_date || sub.trial_end) && (
        <div className="px-5 sm:px-6 py-4 border-t border-[#EAE6D7] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {usageRows.map((row) => {
            const Icon = row.icon;
            return (
              <div key={row.key} className="text-sm" data-testid={`subscription-usage-${row.key}`}>
                <div className="flex items-center gap-1.5 text-[#5C6C62] text-xs uppercase tracking-wide">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {row.label}
                </div>
                <div className="font-medium text-[#2D3A33] mt-0.5">{row.value}</div>
              </div>
            );
          })}
          {(sub.billing_cycle || billingCycle) && sub.status !== "trial" && (
            <div className="text-sm" data-testid="subscription-billing-period">
              <div className="text-[#5C6C62] text-xs uppercase tracking-wide">Billing period</div>
              <div className="font-medium text-[#2D3A33] mt-0.5">
                {cycleLabel(sub.billing_cycle || billingCycle)}
              </div>
            </div>
          )}
          {sub.status === "active" && sub.expiry_date && (
            <div className="text-sm" data-testid="subscription-renewal-date">
              <div className="text-[#5C6C62] text-xs uppercase tracking-wide flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                Renewal date
              </div>
              <div className="font-medium text-[#2D3A33] mt-0.5">
                {new Date(sub.expiry_date).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </div>
            </div>
          )}
          {sub.status === "trial" && sub.trial_end && (
            <div className="text-sm" data-testid="subscription-trial-end">
              <div className="text-[#5C6C62] text-xs uppercase tracking-wide">Trial ends</div>
              <div className="font-medium text-[#2D3A33] mt-0.5">
                {new Date(sub.trial_end).toLocaleDateString(undefined, { dateStyle: "medium" })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-5 sm:px-6 py-5 border-t border-[#EAE6D7] space-y-4">
        <div>
          <div className="text-sm font-medium text-[#2D3A33] mb-2">Choose billing period</div>
          <BillingCyclePicker value={billingCycle} onChange={onBillingCycleChange} fullWidth />
        </div>

        {currentCharge && (
          <div
            className="rounded-xl p-4 sm:p-5 space-y-4"
            style={{ background: "#F8F5EC" }}
            data-testid="amount-due-card"
          >
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-[#5C6C62]">Amount due</div>
                <div
                  className="font-display text-2xl sm:text-3xl text-[#2D3A33] mt-0.5"
                  data-testid="current-plan-renewal-price"
                >
                  {formatIdr(currentCharge.totalIdr)}
                </div>
              </div>
              {currentPlan && (
                <div className="text-sm text-[#5C6C62] sm:text-right shrink-0 space-y-0.5">
                  <div>
                    <span className="text-[#8A9A86]">Plan</span>{" "}
                    <span className="font-medium text-[#2D3A33]">{currentPlan.name}</span>
                  </div>
                  <div>
                    <span className="text-[#8A9A86]">Billing period</span>{" "}
                    <span className="font-medium text-[#2D3A33]">{currentCharge.label}</span>
                  </div>
                  {currentCharge.discountPercent > 0 && (
                    <div>
                      <span className="text-[#8A9A86]">Discount</span>{" "}
                      <span className="font-medium text-[#52796F]">
                        {currentCharge.discountPercent}% (−{formatIdr(discountAmount)})
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <p className="text-sm text-[#5C6C62] pt-3 border-t border-[#EAE6D7]/80">
              {currentCharge.months === 1 ? (
                <>Billed every month · {formatIdr(currentCharge.perMonthIdr)} / month</>
              ) : (
                <>
                  {formatIdr(currentCharge.perMonthIdr)} / month · {currentCharge.months} months upfront
                  {currentCharge.discountPercent > 0 && (
                    <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-[#EDF3EF] text-[#52796F]">
                      Save {currentCharge.discountPercent}%
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 pt-1">
          {showRenew && (
            <button
              type="button"
              onClick={onRenew}
              className="bl-btn-primary flex-1 inline-flex items-center justify-center gap-2 py-3"
              data-testid="renew-plan-button"
            >
              <RefreshCw className="w-4 h-4" />
              {primaryActionLabel}
            </button>
          )}
          {showSubscribe && (
            <button
              type="button"
              onClick={onSubscribe}
              className="bl-btn-primary flex-1 inline-flex items-center justify-center gap-2 py-3"
              data-testid="subscribe-plan-button"
            >
              {primaryActionLabel}
              <ArrowUpRight className="w-4 h-4" />
            </button>
          )}
          {showUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-[#EAE6D7] bg-white text-[#2D3A33] text-sm font-medium hover:bg-[#FBF8EF] transition"
              data-testid="upgrade-plan-button"
            >
              Upgrade plan
              <ArrowUpRight className="w-4 h-4" />
            </button>
          )}
          {onHighestPlan && sub.status !== "trial" && (
            <p className="flex-1 text-sm text-[#5C6C62] text-center sm:text-left py-3">
              You are currently on the highest available plan.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
