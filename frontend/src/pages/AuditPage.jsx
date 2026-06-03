import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";

const MODULES = [
  { value: "", label: "All modules" },
  { value: "appointment", label: "Appointments" },
  { value: "invoice", label: "Invoices" },
  { value: "package", label: "Packages" },
  { value: "commission", label: "Commissions" },
  { value: "staff", label: "Staff & roles" },
  { value: "schedule", label: "Schedules" },
  { value: "clinical_note", label: "Clinical notes" },
  { value: "consent", label: "Consent" },
];

function formatValue(val) {
  if (val == null || val === "") return "—";
  if (typeof val === "object") {
    try {
      const s = JSON.stringify(val);
      return s.length > 120 ? `${s.slice(0, 120)}…` : s;
    } catch {
      return String(val);
    }
  }
  return String(val);
}

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = moduleFilter ? { module: moduleFilter } : {};
      const r = await api.get("/audit-logs", { params });
      setLogs(r.data || []);
    } catch (e) {
      setLogs([]);
      setError(e?.response?.data?.detail || "Could not load audit log");
    } finally {
      setLoading(false);
    }
  }, [moduleFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-[1400px] mx-auto">
      <div className="label-eyebrow">System</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">
        Audit log
      </h1>
      <p className="mt-2 text-[#5C6C62]">
        Sensitive actions across appointments, billing, packages, staff, schedules, clinical notes, and consent.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-[#5C6C62]">
          Module
          <select
            className="ml-2 bl-input text-sm py-1.5"
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
          >
            {MODULES.map((m) => (
              <option key={m.value || "all"} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="mt-6 bl-card p-5 text-[#B14A2C] text-sm">{error}</div>}

      <div className="mt-6 bl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead className="bg-[#F8F5EC]">
              <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">Old value</th>
                <th className="px-4 py-3">New value</th>
                <th className="px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-[#5C6C62]">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && !error && (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-[#5C6C62]">
                    No activity yet
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((l) => (
                  <tr key={l.id} className="border-t border-[#EAE6D7] align-top">
                    <td className="px-4 py-3 text-sm text-[#5C6C62] whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium">{l.user_name || l.user_email}</div>
                      {l.user_name && (
                        <div className="text-xs text-[#5C6C62]">{l.user_email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#5C6C62] capitalize whitespace-nowrap">
                      {(l.user_role || "").replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="bl-chip">{l.action}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#5C6C62] capitalize">
                      {l.module || l.entity || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[#5C6C62]">
                      {(l.record_id || l.entity_id)
                        ? (l.record_id || l.entity_id).slice(0, 12)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#5C6C62] max-w-[180px] break-all" title={formatValue(l.old_value)}>
                      {formatValue(l.old_value)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#5C6C62] max-w-[180px] break-all" title={formatValue(l.new_value ?? l.meta)}>
                      {formatValue(l.new_value ?? l.meta)}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#5C6C62] max-w-[140px]">
                      {l.reason || "—"}
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
