import { Ban, CalendarRange, ChevronDown, Copy, ExternalLink, LayoutList, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function WorkspaceMoreMenu({
  canManage = false,
  clinicSlug,
  viewMode = "schedule",
  onNewAppointment,
  onBlockTime,
  onShowListView,
  onShowScheduleView,
  onCopyPublicLink,
  onBrowserFullscreen,
  isBrowserFullscreen = false,
  container,
  testId = "appointment-workspace-more-menu",
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="bl-btn-secondary text-xs inline-flex items-center gap-1"
          data-testid={testId}
        >
          More
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        container={container}
        className="min-w-[12rem] z-[130] bg-[var(--bl-surface)] border-[var(--bl-border)] text-[var(--bl-text)] shadow-lg"
      >
        {canManage && onNewAppointment && (
          <DropdownMenuItem className="cursor-pointer" onClick={onNewAppointment}>
            <Plus className="w-4 h-4 mr-2 text-[#5C6C62]" />
            New appointment
          </DropdownMenuItem>
        )}
        {canManage && onBlockTime && (
          <DropdownMenuItem className="cursor-pointer" onClick={onBlockTime}>
            <Ban className="w-4 h-4 mr-2 text-[#5C6C62]" />
            Block time
          </DropdownMenuItem>
        )}
        {viewMode === "schedule" && onShowListView && (
          <DropdownMenuItem className="cursor-pointer" onClick={onShowListView}>
            <LayoutList className="w-4 h-4 mr-2 text-[#5C6C62]" />
            List view
          </DropdownMenuItem>
        )}
        {viewMode === "list" && onShowScheduleView && (
          <DropdownMenuItem className="cursor-pointer" onClick={onShowScheduleView}>
            <CalendarRange className="w-4 h-4 mr-2 text-[#5C6C62]" />
            Schedule view
          </DropdownMenuItem>
        )}
        {clinicSlug && onCopyPublicLink && (
          <DropdownMenuItem className="cursor-pointer" onClick={onCopyPublicLink}>
            <Copy className="w-4 h-4 mr-2 text-[#5C6C62]" />
            Copy appointment link
          </DropdownMenuItem>
        )}
        {clinicSlug && (
          <DropdownMenuItem asChild className="cursor-pointer">
            <a
              href={`/book/${clinicSlug}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center w-full"
            >
              <ExternalLink className="w-4 h-4 mr-2 text-[#5C6C62]" />
              View public booking page
            </a>
          </DropdownMenuItem>
        )}
        {onBrowserFullscreen && (
          <DropdownMenuItem className="cursor-pointer" onClick={onBrowserFullscreen}>
            {isBrowserFullscreen ? "Exit browser full screen" : "Browser full screen"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
