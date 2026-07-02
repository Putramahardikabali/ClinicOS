import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import api from "@/lib/api";
import { hasPermission, useAuth } from "@/lib/auth";
import WaitingListForm from "@/components/waitingList/WaitingListForm";
import WaitlistDatePresetFilters from "@/components/waitingList/WaitlistDatePresetFilters";
import {
  DEFAULT_WAITLIST_DATE_PRESET,
  WAITLIST_SOURCES,
  WAITLIST_STATUSES,
  buildWaitlistQueryParams,
  waitlistDisplayName,
  waitlistDisplayPhone,
  waitlistEmptyMessage,
  waitlistPreferredTimeLabel,
  waitlistStatusChip,
} from "@/lib/waitingList";

export default function WaitingListPage() {
  const { user } = useAuth();
  const canReport = hasPermission(user, "waiting_list.report");
  const canCreate = hasPermission(user, "waiting_list.create");

  const [datePreset, setDatePreset] = useState(DEFAULT_WAITLIST_DATE_PRESET);
  const [status, setStatus] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [treatments, setTreatments] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    api.get("/treatments-catalog", { params: { active_only: true } }).then((r) => setTreatments(r.data || [])).catch(() => {});
    api.get("/users").then((r) => setStaff(r.data || [])).catch(() => {});
  }, []);

  const params = useMemo(
    () => buildWaitlistQueryParams({
      datePreset,
      status,
      q,
      treatment_id: treatmentId || undefined,
      staff_id: staffId || undefined,
      source: source || undefined,
    }),
    [datePreset, status, treatmentId, staffId, source, q],
  );

  const load = useCallback(() => {
    setLoading(true);
    const requests = [api.get("/waiting-list", { params })];
    if (canReport) {
      requests.push(api.get("/waiting-list/summary", { params }));
    }
    return Promise.all(requests)
      .then(([listRes, summaryRes]) => {
        setRows(listRes.data || []);
        setSummary(summaryRes?.data || null);
      })
      .catch(() => {
        setRows([]);
        setSummary(null);
      })
      .finally(() => setLoading(false));
  }, [params, canReport]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="waiting-list-page">
      <div className="label-eyebrow">Appointments</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Waiting List</h1>
      <p className="mt-2 text-sm text-[#5C6C62] max-w-2xl">
        Track patients waiting for appointment slots, conversion outcomes, and full history.
      </p>

      {canReport && summary && (
        <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Total", value: summary.total },
            { label: "Got slot", value: summary.booked },
            { label: "Did not get slot", value: summary.not_got_slot },
            { label: "Cancelled", value: summary.cancelled },
            { label: "Conversion", value: `${summary.conversion_rate}%` },
          ].map((card) => (
            <div key={card.label} className="bl-card p-4">
              <div className="text-[10px] uppercase text-[#A89F8B]">{card.label}</div>
              <div className="font-display text-2xl text-[#2D3A33] mt-1">{card.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 bl-card p-4 space-y-4">
        <WaitlistDatePresetFilters value={datePreset} onChange={setDatePreset} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label-eyebrow block mb-1.5">Treatment</label>
            <select className="bl-input w-full" value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)}>
              <option value="">All</option>
              {treatments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Staff</label>
            <select className="bl-input w-full" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">All</option>
              {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <input
          type="search"
          className="bl-input w-full"
          placeholder="Search patient name or phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {WAITLIST_STATUSES.map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              onClick={() => setStatus(f.key)}
              className={`bl-chip ${status === f.key ? "info" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {WAITLIST_SOURCES.filter((s) => s.key).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSource(source === s.key ? "" : s.key)}
              className={`bl-chip ${source === s.key ? "info" : ""}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {canCreate && (
          <button type="button" className="bl-btn-primary text-sm" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? "Hide form" : "Add waiting list entry"}
          </button>
        )}
        {showAdd && (
          <div className="border-t border-[#EAE6D7] pt-4">
            <WaitingListForm
              scheduleDate={new Date().toISOString().slice(0, 10)}
              onSaved={() => { setShowAdd(false); load(); }}
              onCancel={() => setShowAdd(false)}
            />
          </div>
        )}
      </div>

      <div className="mt-6 bl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="bl-data-table w-full min-w-[900px]">
            <thead className="bl-data-table-head">
              <tr>
                <th className="px-4 py-3 text-left">Patient</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Treatment</th>
                <th className="px-4 py-3 text-left">Desired date</th>
                <th className="px-4 py-3 text-left">Preferred</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="text-center py-10 text-[#5C6C62]">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-[#5C6C62]">{waitlistEmptyMessage(datePreset)}</td></tr>
              )}
              {!loading && rows.map((entry) => (
                <tr key={entry.id} data-testid={`waitlist-row-${entry.id}`}>
                  <td className="px-4 py-3 font-medium text-[#2D3A33]">{waitlistDisplayName(entry)}</td>
                  <td className="px-4 py-3 text-sm text-[#5C6C62]">{waitlistDisplayPhone(entry) || "—"}</td>
                  <td className="px-4 py-3 text-sm text-[#5C6C62]">{entry.treatment_name_snapshot || "—"}</td>
                  <td className="px-4 py-3 text-sm text-[#5C6C62]">{entry.desired_date}</td>
                  <td className="px-4 py-3 text-sm text-[#5C6C62]">
                    {waitlistPreferredTimeLabel(entry)}
                    {entry.preferred_staff_name_snapshot ? ` · ${entry.preferred_staff_name_snapshot}` : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`bl-chip ${waitlistStatusChip(entry.status)}`}>
                      {(entry.status || "").replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    {entry.patient_id && (
                      <Link to={`/patients/${entry.patient_id}`} className="text-sm text-[#52796F] hover:underline inline-flex items-center gap-1">
                        Patient <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                    {entry.linked_appointment_id && (
                      <Link to={`/bookings?open=${entry.linked_appointment_id}`} className="text-sm text-[#52796F] hover:underline inline-flex items-center gap-1">
                        Appointment <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
