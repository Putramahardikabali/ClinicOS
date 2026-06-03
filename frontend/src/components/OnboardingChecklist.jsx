import { Link } from "react-router-dom";
import { CheckCircle2, Circle, ChevronRight } from "lucide-react";

export default function OnboardingChecklist({ checklist, compact = false }) {
  if (!checklist || checklist.complete) return null;
  const items = checklist.items || [];
  if (!items.length) return null;

  if (compact) {
    return (
      <div className="bl-card p-4 sm:p-5" data-testid="onboarding-checklist">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="label-eyebrow">Getting started</div>
            <div className="text-sm text-[#5C6C62] mt-0.5">
              {checklist.completed} of {checklist.total} complete ({checklist.percent}%)
            </div>
          </div>
          <div className="w-24 h-2 rounded-full bg-[#EAE6D7] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${checklist.percent}%`, background: "var(--bl-primary)" }} />
          </div>
        </div>
        <ul className="space-y-1.5">
          {items.filter((i) => !i.done).slice(0, 4).map((item) => (
            <li key={item.id}>
              <Link to={item.link} className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg hover:bg-[#F3F1EB] text-[#2D3A33]">
                <Circle className="w-4 h-4 shrink-0 text-[#8AA992]" />
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="w-4 h-4 text-[#5C6C62]" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="bl-card p-5 sm:p-6" data-testid="onboarding-checklist-full">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div className="label-eyebrow">Clinic setup checklist</div>
          <h2 className="font-display text-xl text-[#2D3A33] mt-1">Get your clinic ready</h2>
          <p className="text-sm text-[#5C6C62] mt-1">Complete these steps to start accepting patients.</p>
        </div>
        <div className="text-sm font-medium text-[#52796F]">{checklist.completed}/{checklist.total} done</div>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              to={item.link}
              className={`flex items-center gap-3 p-3 rounded-xl border transition ${item.done ? "border-[#D4E4DC] bg-[#F5FAF7]" : "border-[#EAE6D7] hover:bg-[#F8F5EC]"}`}
            >
              {item.done ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 text-[#52796F]" />
              ) : (
                <Circle className="w-5 h-5 shrink-0 text-[#8AA992]" />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${item.done ? "text-[#5C6C62] line-through" : "text-[#2D3A33] font-medium"}`}>{item.label}</div>
                {item.hint && !item.done && (
                  <div className="text-xs text-[#5C6C62] mt-0.5 truncate">{item.hint}</div>
                )}
              </div>
              {!item.done && <ChevronRight className="w-4 h-4 text-[#5C6C62]" />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
