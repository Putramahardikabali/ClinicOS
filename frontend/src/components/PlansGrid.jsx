import { useState } from "react";
import { Link } from "react-router-dom";
import { useClinic, formatIdr } from "@/lib/clinic";
import { Check, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { computePlanCharge } from "@/lib/billing";

const VISIBLE_FEATURE_COUNT = 6;

function PlanFeaturesList({ highlights }) {
  const [expanded, setExpanded] = useState(false);
  const items = highlights || [];
  const visible = expanded ? items : items.slice(0, VISIBLE_FEATURE_COUNT);
  const hiddenCount = Math.max(0, items.length - VISIBLE_FEATURE_COUNT);

  if (!items.length) return null;

  return (
    <div className="mt-5">
      <ul className="space-y-2 text-sm text-[#2D3A33]">
        {visible.map((h, i) => (
          <li key={i} className="flex items-start gap-2">
            <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--bl-primary)" }} />
            <span>{h}</span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#52796F] hover:text-[#2D3A33] transition"
          data-testid="plan-view-all-features"
        >
          {expanded ? (
            <>
              Show fewer features
              <ChevronUp className="w-4 h-4" />
            </>
          ) : (
            <>
              View all features ({items.length})
              <ChevronDown className="w-4 h-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function PlanBadge({ children, style, testid }) {
  return (
    <div
      className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1 rounded-full text-xs font-semibold text-white flex items-center gap-1 whitespace-nowrap z-10 shadow-sm"
      style={style}
      data-testid={testid}
    >
      {children}
    </div>
  );
}

export function PlansGrid({ onSelect, recommended, billingCycle = "monthly", canSubscribe = true }) {
  const { plans, clinic } = useClinic();
  return (
    <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-5 pt-2" data-testid="plans-grid">
      {plans.map((p) => {
        const popular = p.most_popular;
        const isRecommended = recommended && recommended === p.key;
        const current = clinic?.subscription?.plan === p.key && clinic?.subscription?.status === "active";
        const charge = computePlanCharge(p.price_idr, billingCycle);
        const hasBadge = isRecommended || popular;
        return (
          <div
            key={p.key}
            className={`bl-card relative overflow-visible ${hasBadge ? "mt-3 pt-7" : ""} p-6 ${isRecommended ? "ring-2" : popular ? "ring-2" : ""}`}
            style={isRecommended ? { boxShadow: "0 0 0 2px var(--bl-accent)" } : popular ? { boxShadow: "0 0 0 2px var(--bl-primary)" } : {}}
            data-testid={`plan-card-${p.key}`}
          >
            {isRecommended && (
              <PlanBadge style={{ background: "var(--bl-accent)" }} testid={`plan-recommended-${p.key}`}>
                <Sparkles className="w-3 h-3" /> Recommended for you
              </PlanBadge>
            )}
            {!isRecommended && popular && (
              <PlanBadge style={{ background: "var(--bl-primary)" }}>
                <Sparkles className="w-3 h-3" /> Most popular
              </PlanBadge>
            )}
            <div className="label-eyebrow">{p.name}</div>
            <div className="font-display text-3xl text-[#2D3A33] mt-2" data-testid={`plan-price-${p.key}`}>
              {formatIdr(charge.totalIdr)}
            </div>
            <div className="text-sm text-[#5C6C62] mt-0.5">
              {charge.months === 1 ? (
                <span>per month</span>
              ) : (
                <span>
                  {charge.label} · {formatIdr(charge.perMonthIdr)}/mo
                  {charge.discountPercent > 0 && ` · save ${charge.discountPercent}%`}
                </span>
              )}
            </div>
            <PlanFeaturesList highlights={p.highlights} />
            {current ? (
              <div className="mt-6 w-full text-center py-3 rounded-xl bg-[#EDF3EF] text-[#52796F] font-medium text-sm">Current plan</div>
            ) : !canSubscribe ? (
              <div className="mt-6 w-full text-center py-3 rounded-xl bg-[#F5F2EA] text-[#5C6C62] text-sm">Contact your clinic owner to change plans</div>
            ) : onSelect ? (
              <button type="button" onClick={() => onSelect(p)} className="bl-btn-primary mt-6 w-full" data-testid={`plan-choose-${p.key}`}>Choose this plan</button>
            ) : (
              <Link
                to={`/billing/checkout?plan=${p.key}&cycle=${billingCycle}`}
                className="bl-btn-primary mt-6 w-full inline-block text-center"
                data-testid={`plan-choose-${p.key}`}
              >
                Choose this plan
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
