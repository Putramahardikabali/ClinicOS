import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarPlus,
  Highlighter,
  MessageCircle,
  MoreHorizontal,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SearchInput from "@/components/ui/SearchInput";
import LoyaltyBadge from "@/components/patient/LoyaltyBadge";
import PatientLabelsRow from "@/components/patient/PatientLabelsRow";
import PatientLabelBadge from "@/components/patient/PatientLabelBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isBlacklisted } from "@/lib/patientLabelDisplay";
import { openWhatsgoChatSafe } from "@/lib/whatsgo";
import {
  enrichPatientsWithTodayBookings,
  patientDisplayName,
  patientInitials,
  resolvePatientSearchPrimaryAction,
  searchPatients,
  serviceCountLabel,
} from "@/components/bookings/schedulePatientLookup";

const DROPDOWN_MIN_WIDTH = 560;
const DROPDOWN_MAX_WIDTH = 720;
const DROPDOWN_VIEWPORT_PAD = 16;

function resolveDropdownLayout(inputRect) {
  const viewportWidth = window.innerWidth;
  const maxAllowed = Math.max(280, viewportWidth - 32);
  const isCompact = viewportWidth < 640;
  let width = isCompact
    ? maxAllowed
    : Math.min(DROPDOWN_MAX_WIDTH, Math.max(DROPDOWN_MIN_WIDTH, inputRect.width));
  width = Math.min(width, maxAllowed);

  let left = inputRect.left;
  if (left + width > viewportWidth - DROPDOWN_VIEWPORT_PAD) {
    left = Math.max(DROPDOWN_VIEWPORT_PAD, viewportWidth - DROPDOWN_VIEWPORT_PAD - width);
  }

  const gap = 4;
  const bottomPad = 16;
  const availableBelow = window.innerHeight - inputRect.bottom - gap - bottomPad;
  const maxHeight = Math.min(420, Math.max(180, availableBelow));

  return {
    top: inputRect.bottom + gap,
    left,
    width,
    maxHeight,
  };
}

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function BlacklistBadge() {
  return (
    <PatientLabelBadge
      label={{ name: "Blacklist", severity: "danger", color: "#DC2626" }}
      size="sm"
    />
  );
}

function PatientSearchResultRow({
  patient,
  primaryAction,
  canManage,
  canWhatsgo,
  menuContainer,
  onRowClick,
  onPrimaryAction,
  onHighlight,
  onBook,
  onModify,
  onOpenProfile,
  onOpenWhatsgo,
}) {
  const name = patientDisplayName(patient);
  const phone = patient.phone || "";
  const email = patient.email || "";
  const blacklisted = isBlacklisted(patient);
  const serviceLabel = serviceCountLabel(patient.todayBookingCount);
  const nonBlacklistLabels = (patient.patient_labels || []).filter(
    (lb) =>
      (lb.system_key || "").toLowerCase() !== "blacklist"
      && (lb.name || "").trim().toLowerCase() !== "blacklist",
  );

  const handlePrimary = (e) => {
    e.stopPropagation();
    onPrimaryAction(patient);
  };

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 hover:bg-[#F8F5EC] border-b border-[#EAE6D7] last:border-0 cursor-pointer"
      onClick={() => onRowClick(patient)}
      data-testid={`schedule-patient-result-${patient.id}`}
    >
      <div
        className="shrink-0 w-9 h-9 rounded-full bg-[#E8F0EC] text-[#2D5A45] flex items-center justify-center text-xs font-semibold"
        aria-hidden
      >
        {patientInitials(patient)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <span className="font-medium text-sm text-[#2D3A33] leading-snug line-clamp-2">{name}</span>
          {blacklisted && <BlacklistBadge />}
          {nonBlacklistLabels.length > 0 && (
            <PatientLabelsRow labels={nonBlacklistLabels} size="sm" />
          )}
        </div>
        <div className="text-xs text-[#5C6C62] mt-0.5 leading-relaxed break-words">
          {[phone, email, patient.user_code].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {patient.loyalty_tier?.name && (
            <LoyaltyBadge tier={patient.loyalty_tier} size="sm" />
          )}
          {serviceLabel && (
            <span className="text-[11px] text-[#52796F] font-medium">{serviceLabel}</span>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-start gap-1.5 pl-1">
        {canManage && (
          <button
            type="button"
            className="bl-btn-secondary text-[11px] px-2.5 py-1.5 whitespace-nowrap min-w-[8.5rem] text-center"
            onClick={handlePrimary}
            data-testid={`schedule-patient-action-${patient.id}`}
          >
            {primaryAction.label}
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-1.5 rounded-lg border border-[#EAE6D7] hover:bg-white"
              aria-label={`More actions for ${name}`}
              onClick={(e) => e.stopPropagation()}
              data-testid={`schedule-patient-menu-${patient.id}`}
            >
              <MoreHorizontal className="w-4 h-4 text-[#5C6C62]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            container={menuContainer}
            className="min-w-[11rem] z-[130] bg-[var(--bl-surface)] border-[var(--bl-border)] text-[var(--bl-text)] shadow-lg"
          >
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onOpenProfile(patient); }}
            >
              <User className="w-4 h-4 mr-2 text-[#5C6C62]" />
              Open patient profile
            </DropdownMenuItem>
            {canManage && (
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onBook(patient); }}
              >
                <CalendarPlus className="w-4 h-4 mr-2 text-[#5C6C62]" />
                Book appointment
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onHighlight(patient); }}
            >
              <Highlighter className="w-4 h-4 mr-2 text-[#5C6C62]" />
              Highlight bookings
            </DropdownMenuItem>
            {canWhatsgo && patient.id && (
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onOpenWhatsgo(patient); }}
              >
                <MessageCircle className="w-4 h-4 mr-2 text-[#5C6C62]" />
                Open Whatsgo chat
              </DropdownMenuItem>
            )}
            {patient.todayBookingCount === 1 && canManage && (
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onModify(patient); }}
              >
                Modify appointment
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default function SchedulePatientSearch({
  date,
  canManage = false,
  canWhatsgo = false,
  canCreatePatient = false,
  portalContainer,
  onHighlightPatient,
  onBookPatient,
  onModifyBooking,
  onOpenPatientProfile,
  onCreatePatient,
  className = "",
  inputClassName = "",
}) {
  const inputWrapRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, maxHeight: 360 });
  const debouncedQuery = useDebouncedValue(query, 300);

  const close = useCallback(() => setOpen(false), []);

  const updatePosition = useCallback(() => {
    const el = inputWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(resolveDropdownLayout(rect));
  }, []);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const patients = await searchPatients(q);
        if (cancelled) return;
        const enriched = await enrichPatientsWithTodayBookings(patients, date);
        if (!cancelled) {
          setResults(enriched);
          if (document.activeElement === inputWrapRef.current?.querySelector("input")) {
            setOpen(true);
          }
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedQuery, date]);

  useEffect(() => {
    if (!query.trim()) {
      setOpen(false);
      setResults([]);
    } else if (document.activeElement === inputWrapRef.current?.querySelector("input")) {
      setOpen(true);
    }
  }, [query]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition, results.length, loading]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      const t = e.target;
      if (inputWrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      close();
    };
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
      inputWrapRef.current?.querySelector("input")?.blur();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  const handlePrimaryAction = useCallback((patient) => {
    const action = resolvePatientSearchPrimaryAction(patient.todayBookingCount);
    if (action.key === "book") onBookPatient?.(patient);
    else if (action.key === "modify") onModifyBooking?.(patient.todayBookings?.[0], patient);
    else onHighlightPatient?.(patient);
    close();
    setQuery("");
  }, [onBookPatient, onModifyBooking, onHighlightPatient, close]);

  const handleRowClick = useCallback((patient) => {
    onHighlightPatient?.(patient);
    close();
    setQuery("");
  }, [onHighlightPatient, close]);

  const handleBook = useCallback((patient) => {
    onBookPatient?.(patient);
    close();
    setQuery("");
  }, [onBookPatient, close]);

  const handleModify = useCallback((patient) => {
    const booking = patient.todayBookings?.[0];
    if (booking) onModifyBooking?.(booking, patient);
    close();
    setQuery("");
  }, [onModifyBooking, close]);

  const handleHighlight = useCallback((patient) => {
    onHighlightPatient?.(patient);
    close();
    setQuery("");
  }, [onHighlightPatient, close]);

  const handleOpenProfile = useCallback((patient) => {
    onOpenPatientProfile?.(patient);
    close();
    setQuery("");
  }, [onOpenPatientProfile, close]);

  const handleOpenWhatsgo = useCallback(async (patient) => {
    if (!patient?.id) return;
    await openWhatsgoChatSafe(patient.id);
    close();
  }, [close]);

  const showPanel = open && query.trim();
  const portalTarget = portalContainer || document.body;

  const panel = showPanel
    ? createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Patient search results"
          className={cn(
            "fixed z-[130] rounded-xl border border-[#EAE6D7] bg-white shadow-lg overflow-y-auto overscroll-contain",
          )}
          style={{
            top: pos.top,
            left: pos.left,
            width: pos.width,
            minWidth: pos.width,
            maxWidth: "calc(100vw - 32px)",
            maxHeight: pos.maxHeight,
          }}
          data-testid="schedule-patient-search-panel"
        >
          {loading && (
            <div className="px-4 py-6 text-sm text-center text-[#5C6C62]">Searching patients…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-[#5C6C62]">No patients found</p>
              {canCreatePatient && (
                <button
                  type="button"
                  className="mt-3 text-sm text-[var(--bl-primary)] font-medium hover:underline"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onCreatePatient?.();
                    close();
                    setQuery("");
                  }}
                  data-testid="schedule-patient-search-create"
                >
                  Create new patient
                </button>
              )}
            </div>
          )}
          {!loading && results.map((patient) => (
            <PatientSearchResultRow
              key={patient.id}
              patient={patient}
              primaryAction={resolvePatientSearchPrimaryAction(patient.todayBookingCount)}
              canManage={canManage}
              canWhatsgo={canWhatsgo}
              menuContainer={portalContainer}
              onRowClick={handleRowClick}
              onPrimaryAction={handlePrimaryAction}
              onHighlight={handleHighlight}
              onBook={handleBook}
              onModify={handleModify}
              onOpenProfile={handleOpenProfile}
              onOpenWhatsgo={handleOpenWhatsgo}
            />
          ))}
        </div>,
        portalTarget,
      )
    : null;

  return (
    <div ref={inputWrapRef} className={cn("relative flex-1 min-w-[12rem] max-w-md overflow-visible", className)}>
      <SearchInput
        className="w-full"
        inputClassName={cn("text-sm py-2", inputClassName)}
        placeholder="Search patient, phone, email, code"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (query.trim()) setOpen(true);
        }}
        data-testid="schedule-patient-search"
      />
      {panel}
    </div>
  );
}
