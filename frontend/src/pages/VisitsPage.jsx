import { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, hasPermission } from "@/lib/auth";

export default function VisitsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [performerFilter, setPerformerFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const canFilterPerformer = hasPermission(user, "visits.view");

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (statusFilter) params.status = statusFilter;
    if (performerFilter && canFilterPerformer) params.assigned_to = performerFilter;
    return api.get("/visits", { params })
      .then((r) => setItems(r.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [statusFilter, performerFilter, canFilterPerformer]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canFilterPerformer) return;
    api.get("/users").then((r) => {
      const list = (r.data || []).filter((u) => ["doctor", "therapist", "nurse"].includes(u.role));
      setUsers(list);
    }).catch(() => setUsers([]));
  }, [canFilterPerformer]);

  const filtered = useMemo(() => {
    return items.filter((v) => {
      if (typeFilter && v.visit_type !== typeFilter) return false;
      const d = new Date(v.visit_date || v.created_at);
      if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        if (d < from) return false;
      }
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        if (d > to) return false;
      }
      return true;
    });
  }, [items, typeFilter, fromDate, toDate]);

  const openVisit = (id) => navigate(`/visits/${id}`);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="visits-page">
      <div className="label-eyebrow">Clinical workflow</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Treatment sessions</h1>
      <p className="mt-2 text-sm text-[#5C6C62] max-w-xl">
        Open a treatment session to document notes, treatments, consent, and photos. Your list only shows sessions you are allowed to access.
      </p>

      <div className="mt-6 bl-card p-4 space-y-4" data-testid="visits-filters">
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${canFilterPerformer ? "lg:grid-cols-4" : "lg:grid-cols-2"}`}>
          <div className="min-w-0">
            <label className="label-eyebrow block mb-1.5">From</label>
            <input
              type="date"
              className="bl-input w-full min-h-[44px]"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              data-testid="visits-from-date"
            />
          </div>
          <div className="min-w-0">
            <label className="label-eyebrow block mb-1.5">To</label>
            <input
              type="date"
              className="bl-input w-full min-h-[44px]"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              data-testid="visits-to-date"
            />
          </div>
          {canFilterPerformer && (
            <div className="min-w-0 sm:col-span-2 lg:col-span-2">
              <label className="label-eyebrow block mb-1.5">Staff</label>
              <select
                className="bl-input w-full min-h-[44px]"
                value={performerFilter}
                onChange={(e) => setPerformerFilter(e.target.value)}
                data-testid="visits-performer-filter"
              >
                <option value="">All staff</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div>
          <div className="label-eyebrow mb-2">Status</div>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "", label: "All" },
              { value: "in_progress", label: "In progress" },
              { value: "submitted", label: "Submitted" },
              { value: "completed", label: "Completed" },
            ].map(({ value, label }) => (
              <button
                key={value || "all"}
                type="button"
                onClick={() => setStatusFilter(value)}
                className={`bl-chip ${statusFilter === value ? "info" : ""}`}
                data-testid={`filter-${value || "all"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label-eyebrow mb-2">Type</div>
          <div className="flex flex-wrap gap-2">
            {[
              { value: "", label: "All" },
              { value: "doctor", label: "Doctor" },
              { value: "therapist", label: "Therapist" },
              { value: "nurse", label: "Nurse" },
            ].map(({ value, label }) => (
              <button
                key={value || "all-type"}
                type="button"
                onClick={() => setTypeFilter(value)}
                className={`bl-chip ${typeFilter === value ? "info" : ""}`}
                data-testid={`type-filter-${value || "all"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3 lg:hidden">
        {loading && <div className="bl-card p-8 text-center text-[#5C6C62]">Loading sessions…</div>}
        {!loading && filtered.length === 0 && <div className="bl-card p-8 text-center text-[#5C6C62]">No sessions match your filters.</div>}
        {!loading && filtered.map((v) => (
          <div key={v.id} className="bl-card p-4 flex items-center gap-3" data-testid={`visit-card-${v.id}`}>
            <button
              type="button"
              onClick={() => openVisit(v.id)}
              className="flex items-center gap-3 flex-1 min-w-0 text-left active:bg-[#FBF8EF] -m-2 p-2 rounded-xl"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#F3F1EB] flex flex-col items-center justify-center shrink-0">
                <span className="font-display text-base text-[#2D3A33] leading-none">{new Date(v.visit_date || v.created_at).getDate()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[#2D3A33] truncate">{v.patient_name}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-[#5C6C62] capitalize">{v.visit_type}</span>
                  <span className={`bl-chip text-[10px] py-0.5 px-1.5 ${v.status === "completed" ? "success" : v.status === "submitted" ? "warning" : "info"}`}>{v.status.replace("_", " ")}</span>
                </div>
              </div>
              <span className="text-sm text-[#8A9A86] shrink-0">Open →</span>
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 bl-card overflow-hidden hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-[#F8F5EC]">
              <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                <th className="px-5 py-3">Patient</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="text-center py-10 text-[#5C6C62]">Loading sessions…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-[#5C6C62]">No sessions match your filters.</td></tr>}
              {!loading && filtered.map((v) => (
                <tr
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openVisit(v.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openVisit(v.id);
                    }
                  }}
                  className="border-t border-[#EAE6D7] hover:bg-[#FBF8EF] cursor-pointer transition-colors group"
                  data-testid={`visit-row-${v.id}`}
                >
                  <td className="px-5 py-4 font-medium text-[#2D3A33]">{v.patient_name}</td>
                  <td className="px-5 py-4 capitalize text-[#5C6C62]">{v.visit_type}</td>
                  <td className="px-5 py-4">
                    <span className={`bl-chip ${v.status === "completed" ? "success" : v.status === "submitted" ? "warning" : "info"}`}>{v.status.replace("_", " ")}</span>
                  </td>
                  <td className="px-5 py-4 text-sm text-[#5C6C62]">{new Date(v.visit_date || v.created_at).toLocaleString()}</td>
                  <td className="px-5 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <Link to={`/visits/${v.id}`} className="text-sm text-[#8A9A86] group-hover:text-[#52796F]">Open →</Link>
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
