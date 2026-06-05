import { Link, useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, X, ChevronRight } from "lucide-react";
import { useFrontDeskReminders } from "@/lib/frontDeskReminderContext";
import { formatReminderTime } from "@/lib/appointmentReminders";

const CARD_SHELL =
  "rounded-xl border border-l-4 shadow-[0_10px_28px_rgba(45,58,51,0.14)] ring-1 ring-black/[0.04]";

const REMINDER_VISUALS = {
  unconfirmed_one_hour: {
    shell: `${CARD_SHELL} bg-[#FFFBEB] border-[#E5C76B] border-l-[#D97706]`,
    iconWrap: "bg-[#FEF3C7] text-[#B45309] ring-1 ring-[#FDE68A]/80",
    label: "Needs confirmation",
    Icon: Bell,
    labelClass: "text-[#92400E]",
  },
  session_not_started: {
    shell: `${CARD_SHELL} bg-[#FFF5F0] border-[#F0B89A] border-l-[#C2410C]`,
    iconWrap: "bg-[#FFEDD5] text-[#B14A2C] ring-1 ring-[#FDBA74]/60",
    label: "Needs attention",
    Icon: AlertTriangle,
    labelClass: "text-[#9A3412]",
  },
  grouped: {
    shell: `${CARD_SHELL} bg-[#FFFBEB] border-[#E5C76B] border-l-[#D97706]`,
    iconWrap: "bg-[#FEF3C7] text-[#B45309] ring-1 ring-[#FDE68A]/80",
    label: "Needs attention",
    Icon: Bell,
    labelClass: "text-[#92400E]",
  },
};

function getReminderVisuals(kind) {
  return REMINDER_VISUALS[kind] || REMINDER_VISUALS.grouped;
}

function ReminderIcon({ kind, size = "md" }) {
  const visuals = getReminderVisuals(kind);
  const Icon = visuals.Icon;
  const box = size === "lg" ? "w-10 h-10" : "w-9 h-9";
  const icon = size === "lg" ? "w-5 h-5" : "w-[1.125rem] h-[1.125rem]";
  return (
    <div className={`${box} rounded-full flex items-center justify-center shrink-0 ${visuals.iconWrap}`}>
      <Icon className={icon} strokeWidth={2.25} aria-hidden />
    </div>
  );
}

function ReminderRow({ reminder, onConfirm, onStartSession, busyId }) {
  const time = formatReminderTime(reminder.scheduled_at);
  const isConfirm = reminder.kind === "unconfirmed_one_hour";
  const bid = reminder.booking_id;
  const visuals = getReminderVisuals(reminder.kind);

  return (
    <div
      className={`${visuals.shell} px-4 py-3.5`}
      data-testid={`fd-reminder-row-${reminder.reminder_key}`}
    >
      <div className="flex items-start gap-3">
        <ReminderIcon kind={reminder.kind} />
        <div className="min-w-0 flex-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${visuals.labelClass}`}>
            {visuals.label}
          </span>
          <div className="text-sm font-semibold text-[#2D3A33] mt-1">{reminder.title}</div>
          <div className="text-sm font-medium text-[#2D3A33] mt-1.5">
            {reminder.patient_name}
            <span className="text-[#5C6C62] font-normal"> · </span>
            <span className="text-[#2D3A33]">{time}</span>
          </div>
          <div className="text-xs text-[#5C6C62] mt-1">{reminder.treatment}</div>
          <div className="text-xs text-[#5C6C62] mt-1">{reminder.message}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3 pl-12">
        {isConfirm ? (
          <button
            type="button"
            className="bl-btn-primary text-xs py-1.5 px-3 min-h-[32px]"
            disabled={busyId === bid}
            onClick={() => onConfirm(reminder)}
            data-testid={`fd-reminder-confirm-${bid}`}
          >
            {busyId === bid ? "Confirming…" : "Confirm"}
          </button>
        ) : (
          <button
            type="button"
            className="bl-btn-primary text-xs py-1.5 px-3 min-h-[32px]"
            disabled={busyId === bid}
            onClick={() => onStartSession(reminder)}
            data-testid={`fd-reminder-start-${bid}`}
          >
            {busyId === bid ? "Starting…" : "Start session"}
          </button>
        )}
        <Link
          to={reminder.link || `/bookings?open=${bid}`}
          className="bl-btn-ghost text-xs py-1.5 px-3 min-h-[32px] bg-white/70"
          data-testid={`fd-reminder-open-${bid}`}
        >
          Open
        </Link>
      </div>
    </div>
  );
}

function useReminderReviewNow() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeReminders, openPanel, setCardHidden } = useFrontDeskReminders();

  return () => {
    setCardHidden(true);
    const onDashboard = location.pathname === "/" || location.pathname === "/front-desk";
    if (onDashboard) {
      openPanel();
      window.setTimeout(() => {
        document.getElementById("fd-appointment-reminders-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
      return;
    }
    if (activeReminders.length === 1) {
      navigate(activeReminders[0].link || `/bookings?open=${activeReminders[0].booking_id}`);
      return;
    }
    navigate("/?fd_reminders=1");
  };
}

/** Inline list panel — rendered on Front Desk dashboard only. */
export function AppointmentRemindersPanel() {
  const ctx = useFrontDeskReminders();
  if (!ctx?.enabled || ctx.readOnly) return null;

  const {
    grouped,
    panelOpen,
    closePanel,
    busyId,
    handleConfirm,
    handleStartSession,
  } = ctx;

  if (!panelOpen) return null;

  return (
    <section
      id="fd-appointment-reminders-panel"
      className="scroll-mt-24"
      data-testid="fd-reminders-panel"
    >
      <div className={`${REMINDER_VISUALS.grouped.shell} p-5`}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <ReminderIcon kind="grouped" size="lg" />
            <div>
              <div className={`text-[10px] font-semibold uppercase tracking-wider ${REMINDER_VISUALS.grouped.labelClass}`}>
                Needs attention
              </div>
              <h2 className="font-display text-lg text-[#2D3A33]">Appointment reminders</h2>
            </div>
          </div>
          <button
            type="button"
            className="text-sm text-[#5C6C62] hover:text-[#2D3A33] px-2 py-1 rounded-lg hover:bg-white/60"
            onClick={closePanel}
            data-testid="fd-reminders-panel-close"
          >
            Close
          </button>
        </div>

        {grouped.confirm.length > 0 && (
          <div className="mb-5" data-testid="fd-reminders-group-confirm">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#92400E] mb-2">
              Needs confirmation
            </h3>
            <div className="space-y-3">
              {grouped.confirm.map((r) => (
                <ReminderRow
                  key={r.reminder_key}
                  reminder={r}
                  onConfirm={handleConfirm}
                  onStartSession={handleStartSession}
                  busyId={busyId}
                />
              ))}
            </div>
          </div>
        )}

        {grouped.session.length > 0 && (
          <div data-testid="fd-reminders-group-session">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[#9A3412] mb-2">
              Treatment session not started
            </h3>
            <div className="space-y-3">
              {grouped.session.map((r) => (
                <ReminderRow
                  key={r.reminder_key}
                  reminder={r}
                  onConfirm={handleConfirm}
                  onStartSession={handleStartSession}
                  busyId={busyId}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Fixed reminder card — persistent across FO routes via AppShell. */
export function AppointmentRemindersFloatingCard() {
  const ctx = useFrontDeskReminders();
  const handleReviewNow = useReminderReviewNow();
  if (!ctx?.enabled || ctx.readOnly) return null;

  const {
    activeReminders,
    grouped,
    cardHidden,
    busyId,
    handleDismiss,
    handleConfirm,
    handleStartSession,
  } = ctx;

  const showFloatingCard = activeReminders.length > 0 && !cardHidden;
  if (!showFloatingCard) return null;

  const single = activeReminders.length === 1 ? activeReminders[0] : null;
  const cardKind = single ? single.kind : "grouped";
  const cardVisuals = getReminderVisuals(cardKind);

  return (
    <div
      className="fixed z-50 w-[calc(100%-2rem)] max-w-[400px] left-4 right-4 mx-auto sm:left-auto sm:right-5 sm:mx-0 bottom-[calc(6.25rem+env(safe-area-inset-bottom,0px))] sm:bottom-6"
      data-testid="fd-reminder-card"
    >
      <div className={`${cardVisuals.shell} p-3.5 sm:p-4`}>
        <div className="flex items-start gap-2.5">
          <ReminderIcon kind={cardKind} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className={`text-[10px] font-semibold uppercase tracking-wider ${cardVisuals.labelClass}`}>
                  {cardVisuals.label}
                </div>
                {single ? (
                  <div
                    className="text-sm font-semibold text-[#2D3A33] mt-0.5 leading-snug"
                    data-testid="fd-reminder-card-title"
                  >
                    {single.title}
                  </div>
                ) : (
                  <div
                    className="text-sm font-semibold text-[#2D3A33] mt-0.5 leading-snug"
                    data-testid="fd-reminder-card-grouped"
                  >
                    {grouped.total} items need attention
                  </div>
                )}
              </div>
              <button
                type="button"
                className="p-1 rounded-lg hover:bg-white/70 text-[#5C6C62] shrink-0 -mt-0.5"
                aria-label="Dismiss reminder"
                onClick={() => {
                  if (single) {
                    handleDismiss([single.reminder_key]);
                  } else {
                    handleDismiss(activeReminders.map((r) => r.reminder_key));
                  }
                }}
                data-testid="fd-reminder-card-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {single ? (
              <>
                <div className="text-xs text-[#5C6C62] mt-1 leading-relaxed">{single.message}</div>
                <div className="text-sm font-semibold text-[#2D3A33] mt-1.5">
                  {single.patient_name}
                  <span className="text-[#5C6C62] font-normal"> · </span>
                  {formatReminderTime(single.scheduled_at)}
                </div>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {single.kind === "unconfirmed_one_hour" && (
                    <button
                      type="button"
                      className="bl-btn-primary text-xs py-1.5 px-3 min-h-[36px]"
                      disabled={busyId === single.booking_id}
                      onClick={() => handleConfirm(single)}
                      data-testid="fd-reminder-card-confirm"
                    >
                      Confirm
                    </button>
                  )}
                  {single.kind === "session_not_started" && (
                    <button
                      type="button"
                      className="bl-btn-primary text-xs py-1.5 px-3 min-h-[36px]"
                      disabled={busyId === single.booking_id}
                      onClick={() => handleStartSession(single)}
                      data-testid="fd-reminder-card-start"
                    >
                      Start session
                    </button>
                  )}
                  <Link
                    to={single.link}
                    className="bl-btn-ghost text-xs py-1.5 px-3 min-h-[36px] bg-white/70"
                    data-testid="fd-reminder-card-open"
                  >
                    Open
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs font-medium text-[#2D3A33] mt-1 leading-relaxed">
                  {grouped.confirm.length > 0 && `${grouped.confirm.length} need confirmation`}
                  {grouped.confirm.length > 0 && grouped.session.length > 0 && " · "}
                  {grouped.session.length > 0 && `${grouped.session.length} treatment sessions not started`}
                </div>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  <button
                    type="button"
                    className="bl-btn-primary text-xs py-1.5 px-3 min-h-[36px] inline-flex items-center gap-1"
                    onClick={handleReviewNow}
                    data-testid="fd-reminder-review-now"
                  >
                    Review now <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="bl-btn-ghost text-xs py-1.5 px-3 min-h-[36px] bg-white/70"
                    onClick={() => handleDismiss(activeReminders.map((r) => r.reminder_key))}
                    data-testid="fd-reminder-dismiss"
                  >
                    Dismiss
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
