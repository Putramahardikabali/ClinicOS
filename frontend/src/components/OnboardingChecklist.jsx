import { Link } from "react-router-dom";
import { CheckCircle2, Circle, X } from "lucide-react";

const ITEM_DESCRIPTIONS = {
  clinic_profile: "Add your clinic name and basic information.",
  first_staff: "Invite the people who will use ClinicOS.",
  first_treatment: "Add the services your clinic offers.",
  staff_schedule: "Set working hours for doctors, therapists, or nurses.",
  first_patient: "Create a patient profile for testing or real use.",
  first_booking: "Schedule a patient with available assigned staff.",
  first_visit: "Start a treatment session to record care and prepare billing.",
  first_invoice: "Create billing from a completed treatment session.",
};

const ITEM_ACTION_LABELS = {
  clinic_profile: "Add clinic profile",
  first_staff: "Add staff",
  first_treatment: "Add treatment",
  staff_schedule: "Set schedule",
  first_patient: "Add patient",
  first_booking: "Create appointment",
  first_visit: "Start treatment session",
  first_invoice: "Create invoice",
};

export default function OnboardingChecklist({ checklist, onDismiss, dismissing = false }) {
  if (!checklist || checklist.complete) return null;
  const items = checklist.items || [];
  if (!items.length) return null;

  const total = checklist.total || items.length;

  return (
    <div className="bl-card p-5 sm:p-6" data-testid="setup-checklist">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0 flex-1">
          <div className="label-eyebrow">Getting started</div>
          <h2 className="font-display text-xl text-[#2D3A33] mt-1">Complete your clinic setup</h2>
          <p className="text-sm text-[#5C6C62] mt-1">
            Set up the basics so your team can start using ClinicOS for daily operations.
          </p>
          <p className="text-sm text-[#5C6C62] mt-2">
            Set up your clinic in this order so appointments, treatment sessions, and billing work correctly.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          disabled={dismissing || !onDismiss}
          className="text-sm text-[#5C6C62] hover:text-[#2D3A33] inline-flex items-center gap-1 shrink-0 disabled:opacity-50"
          data-testid="setup-checklist-hide"
        >
          <X className="w-4 h-4" />
          Hide checklist
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm font-medium text-[#52796F]" data-testid="setup-checklist-progress">
          {checklist.completed} of {total} completed
        </div>
        <div className="w-full sm:w-40 h-2 rounded-full bg-[#EAE6D7] overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${checklist.percent || 0}%`, background: "var(--bl-primary)" }}
          />
        </div>
      </div>

      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={`flex flex-wrap items-center gap-3 p-3 rounded-xl border transition ${
              item.done ? "border-[#D4E4DC] bg-[#F5FAF7]" : "border-[#EAE6D7] bg-white"
            }`}
            data-testid={`setup-checklist-item-${item.id}`}
          >
            {item.done ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-[#52796F]" />
            ) : (
              <Circle className="w-5 h-5 shrink-0 text-[#8AA992]" />
            )}
            <div className="flex-1 min-w-0">
              <div className={`text-sm ${item.done ? "text-[#5C6C62] line-through" : "text-[#2D3A33] font-medium"}`}>
                {item.label}
              </div>
              <div className="text-xs text-[#5C6C62] mt-0.5">
                {ITEM_DESCRIPTIONS[item.id] || item.hint || ""}
              </div>
            </div>
            {!item.done && item.link && (
              <Link
                to={item.link}
                className="bl-btn-secondary text-sm shrink-0 whitespace-nowrap"
                data-testid={`setup-checklist-action-${item.id}`}
              >
                {ITEM_ACTION_LABELS[item.id] || "Open"}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
