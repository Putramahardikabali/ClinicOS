import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, ExternalLink, MoreHorizontal, Phone, X } from "lucide-react";
import api from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import WaitingListForm from "@/components/waitingList/WaitingListForm";
import {
  CANCEL_REASONS,
  DATE_PRESETS,
  WAITLIST_STATUSES,
  resolveWaitlistDateRange,
  waitlistDisplayName,
  waitlistDisplayPhone,
  waitlistPreferredTimeLabel,
  waitlistPriorityChip,
  waitlistStatusChip,
} from "@/lib/waitingList";

function PanelShell({ title, children, footer }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-[#EAE6D7] shrink-0">
        <h2 className="font-display text-lg text-[#2D3A33]">{title}</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">{children}</div>
      {footer && (
        <div className="shrink-0 px-4 py-3 border-t border-[#EAE6D7] bg-[#FAFAF7]">{footer}</div>
      )}
    </div>
  );
}

function OpenPageLink({ to, label = "Open full page" }) {
  return (
    <a
      href={to}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-[#52796F] hover:text-[#2D3A33] hover:underline"
    >
      <ExternalLink className="w-3.5 h-3.5" />
      {label}
    </a>
  );
}

function EntryCard({
  entry,
  canUpdate,
  canCancel,
  canConvert,
  onRefresh,
  onCreateAppointment,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const patchStatus = async (status, extra = {}) => {
    setBusy(true);
    try {
      await api.post(`/waiting-list/${entry.id}/status`, { status, ...extra });
      onRefresh?.();
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const handleMarkBooked = async () => {
    if (entry.linked_appointment_id) {
      await patchStatus("booked");
      return;
    }
    if (canConvert && window.confirm("No appointment linked yet. Create appointment now?")) {
      onCreateAppointment?.(entry);
      return;
    }
    const note = window.prompt("Optional note for manual booked status:");
    if (note === null) return;
    await patchStatus("booked", { note: note || undefined });
  };

  const handleCancel = async () => {
    const reasonKey = window.prompt(
      `Cancel reason:\n${CANCEL_REASONS.map((r) => r.key).join(", ")}`,
      "patient_no_longer_interested",
    );
    if (!reasonKey) return;
    const match = CANCEL_REASONS.find((r) => r.key === reasonKey);
    await patchStatus("cancelled", { cancelled_reason: match ? match.key : "other" });
  };

  const notesPreview = (entry.notes || "").trim();
  const truncatedNotes = notesPreview.length > 80 ? `${notesPreview.slice(0, 80)}…` : notesPreview;

  return (
    <div
      className="rounded-lg border border-[#EAE6D7] px-3 py-2 bg-white"
      data-testid={`waitlist-card-${entry.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm text-[#2D3A33] truncate">{waitlistDisplayName(entry)}</div>
          <div className="text-xs text-[#5C6C62] flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3 shrink-0" />
            <span className="truncate">{waitlistDisplayPhone(entry) || "—"}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {entry.priority !== "normal" && (
            <span className={`bl-chip text-[10px] py-0.5 px-1.5 ${waitlistPriorityChip(entry.priority)}`}>
              {entry.priority}
            </span>
          )}
          <span className={`bl-chip text-[10px] py-0.5 px-1.5 ${waitlistStatusChip(entry.status)}`}>
            {(entry.status || "").replace("_", " ")}
          </span>
        </div>
      </div>
      <div className="text-xs text-[#5C6C62] mt-1 truncate">
        {entry.treatment_name_snapshot || "—"} · {entry.desired_date}
      </div>
      <div className="text-xs text-[#5C6C62] mt-0.5 truncate">
        {waitlistPreferredTimeLabel(entry)}
        {entry.preferred_staff_name_snapshot ? ` · ${entry.preferred_staff_name_snapshot}` : ""}
      </div>
      {truncatedNotes && (
        <div className="text-[10px] text-[#A89F8B] mt-1 line-clamp-2">{truncatedNotes}</div>
      )}
      <div className="flex items-center gap-1 mt-2">
        {canUpdate && entry.status !== "booked" && entry.status !== "cancelled" && (
          <button
            type="button"
            title="Mark as got slot / booked"
            disabled={busy}
            onClick={handleMarkBooked}
            className="p-1.5 rounded hover:bg-[#EDF3EF] text-[#2C7755]"
            data-testid={`waitlist-booked-${entry.id}`}
          >
            <Check className="w-4 h-4" />
          </button>
        )}
        {canCancel && entry.status !== "cancelled" && entry.status !== "booked" && (
          <button
            type="button"
            title="Cancel from waiting list"
            disabled={busy}
            onClick={handleCancel}
            className="p-1.5 rounded hover:bg-[#F0EBEB] text-[#B14A2C]"
            data-testid={`waitlist-cancel-${entry.id}`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {canConvert && entry.status !== "booked" && entry.status !== "cancelled" && (
          <button
            type="button"
            title="Create appointment"
            disabled={busy}
            onClick={() => onCreateAppointment?.(entry)}
            className="p-1.5 rounded hover:bg-[#F8F5EC] text-[#52796F]"
            data-testid={`waitlist-create-appt-${entry.id}`}
          >
            <CalendarPlus className="w-4 h-4" />
          </button>
        )}
        {canUpdate && (
          <div className="relative">
            <button
              type="button"
              className="p-1.5 rounded hover:bg-[#F3F1EB] text-[#5C6C62]"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-[#EAE6D7] rounded-lg shadow-lg py-1 min-w-[140px]">
                {entry.status === "waiting" && (
                  <button type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#F8F5EC]" onClick={() => patchStatus("contacted")}>
                    Mark contacted
                  </button>
                )}
                {["waiting", "contacted"].includes(entry.status) && (
                  <button type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#F8F5EC]" onClick={() => patchStatus("slot_offered")}>
                    Slot offered
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function WaitingListPanel({ scheduleDate, onCreateAppointment }) {
  const { user } = useAuth();
  const canCreate = hasPermission(user, "waiting_list.create");
  const canUpdate = hasPermission(user, "waiting_list.update");
  const canCancel = hasPermission(user, "waiting_list.cancel");
  const canConvert = hasPermission(user, "waiting_list.convert_to_appointment");

  const [mode, setMode] = useState("list");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [datePreset, setDatePreset] = useState("schedule");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const dateRange = useMemo(
    () => resolveWaitlistDateRange(datePreset, scheduleDate),
    [datePreset, scheduleDate],
  );

  const load = useCallback(() => {
    setLoading(true);
    const params = { from: dateRange.from, to: dateRange.to };
    if (status) params.status = status;
    if (q.trim()) params.q = q.trim();
    return api
      .get("/waiting-list", { params })
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [dateRange, status, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  if (mode === "add") {
    return (
      <PanelShell
        title="Add waiting list"
        footer={(
          <button type="button" className="text-sm text-[#52796F] hover:underline" onClick={() => setMode("list")}>
            ← Back to list
          </button>
        )}
      >
        <WaitingListForm
          scheduleDate={scheduleDate}
          compact
          onSaved={() => { setMode("list"); refresh(); }}
          onCancel={() => setMode("list")}
        />
      </PanelShell>
    );
  }

  return (
    <PanelShell
      title="Waiting List"
      footer={<OpenPageLink to="/waiting-list" label="Open Waiting List page" />}
    >
      <input
        type="search"
        className="bl-input w-full text-sm mb-3"
        placeholder="Patient name or phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex flex-wrap gap-1.5 mb-3">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setDatePreset(p.key)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              datePreset === p.key
                ? "border-[#52796F] bg-[#EDF3EF] text-[#2C7755]"
                : "border-[#EAE6D7] text-[#5C6C62]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {WAITLIST_STATUSES.slice(0, 5).map((f) => (
          <button
            key={f.key || "all"}
            type="button"
            onClick={() => setStatus(f.key)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              status === f.key
                ? "border-[#52796F] bg-[#EDF3EF] text-[#2C7755]"
                : "border-[#EAE6D7] text-[#5C6C62]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {canCreate && (
        <button
          type="button"
          className="bl-btn-primary w-full text-sm mb-3"
          onClick={() => setMode("add")}
          data-testid="waitlist-add-button"
        >
          Add waiting list
        </button>
      )}
      {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-[#5C6C62]">No waiting list entries for this date.</p>
      )}
      <div className="space-y-2" data-testid="schedule-waitlist-list">
        {rows.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            canUpdate={canUpdate}
            canCancel={canCancel}
            canConvert={canConvert}
            onRefresh={refresh}
            onCreateAppointment={onCreateAppointment}
          />
        ))}
      </div>
    </PanelShell>
  );
}
