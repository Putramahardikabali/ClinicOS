import { Check, AlertTriangle } from "lucide-react";

const STATUS_STYLE = {
  done: { ring: "var(--bl-primary)", bg: "var(--bl-primary)", text: "#fff", icon: Check },
  current: { ring: "var(--bl-primary)", bg: "#fff", text: "var(--bl-primary)", icon: null },
  warning: { ring: "#B45309", bg: "#FEF3C7", text: "#92400E", icon: AlertTriangle },
  pending: { ring: "#C5CFC0", bg: "#fff", text: "#5C6C62", icon: null },
};

export default function VisitWorkflowStepper({ steps, currentId, statuses, onSelect }) {
  return (
    <nav
      className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth"
      aria-label="Treatment session workflow"
      data-testid="visit-workflow-stepper"
    >
      {steps.map((step, index) => {
        const status = statuses[step.id] || "pending";
        const isCurrent = step.id === currentId;
        const visual = isCurrent ? "current" : status;
        const style = STATUS_STYLE[visual] || STATUS_STYLE.pending;
        const Icon = style.icon;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(step.id)}
            className="flex items-center gap-2 shrink-0 min-w-[7.5rem] max-w-[10rem] rounded-xl border px-3 py-2 text-left transition hover:bg-[#FBF8EF]"
            style={{
              borderColor: isCurrent ? style.ring : "#EAE6D7",
              background: isCurrent ? "#F8F5EC" : "#fff",
            }}
            data-testid={`workflow-step-${step.id}`}
            data-status={status}
            data-current={isCurrent ? "true" : "false"}
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold border-2"
              style={{
                borderColor: style.ring,
                background: style.bg,
                color: style.text,
              }}
            >
              {Icon ? <Icon className="w-3.5 h-3.5" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-widest text-[#5C6C62]">
                Step {index + 1}
              </span>
              <span className="block text-sm font-medium text-[#2D3A33] truncate" title={step.label}>
                {step.shortLabel || step.label}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
