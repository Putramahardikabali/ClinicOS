import { Menu } from "lucide-react";
import { useAppointmentWorkspace } from "@/lib/appointmentWorkspaceContext";
import WorkspaceMoreMenu from "@/components/bookings/WorkspaceMoreMenu";

export default function AppointmentListWorkspace({
  canManage,
  clinicSlug,
  onNewAppointment,
  onBlockTime,
  onShowScheduleView,
  onCopyPublicLink,
  onBrowserFullscreen,
  isBrowserFullscreen,
  scopeTabs,
  children,
}) {
  const { toggleNavigationDrawer } = useAppointmentWorkspace();

  return (
    <div
      className="flex flex-col flex-1 min-h-0 h-full bg-[#FDFBF7] p-3 sm:p-4"
      data-testid="appointment-list-workspace"
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 shrink-0">
        <button
          type="button"
          className="bl-icon-btn"
          onClick={toggleNavigationDrawer}
          aria-label="Open navigation menu"
          data-testid="appointment-nav-menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="font-display text-lg text-[var(--bl-text)]">Appointments</div>
        <div className="ml-auto flex items-center gap-2">
          <WorkspaceMoreMenu
            canManage={canManage}
            clinicSlug={clinicSlug}
            viewMode="list"
            onNewAppointment={onNewAppointment}
            onBlockTime={onBlockTime}
            onShowScheduleView={onShowScheduleView}
            onCopyPublicLink={onCopyPublicLink}
            onBrowserFullscreen={onBrowserFullscreen}
            isBrowserFullscreen={isBrowserFullscreen}
          />
        </div>
      </div>
      {scopeTabs}
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
