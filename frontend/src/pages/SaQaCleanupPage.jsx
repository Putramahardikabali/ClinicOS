import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  AlertTriangle, CheckSquare, RefreshCw, Square, Trash2, Eye,
} from "lucide-react";
import SearchInput from "@/components/ui/SearchInput";

const CONFIRM_PHRASE = "DELETE QA CLINICS";
const card = { background: "#141B22", border: "1px solid #1F2A30", borderRadius: "12px" };
const muted = { color: "#8FA89E" };
const text = { color: "#E6E8E6" };

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

export default function SaQaCleanupPage() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(() => new Set());
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get("/superadmin/clinics", { params: { test_only: true, q: q || undefined, list_filter: "all" } })
      .then((r) => {
        const list = r.data || [];
        setRows(list);
        setSelected((prev) => {
          const ids = new Set(list.map((c) => c.id));
          const next = new Set();
          prev.forEach((id) => { if (ids.has(id)) next.add(id); });
          return next;
        });
      })
      .catch(() => toast.error("Failed to load test clinics"))
      .finally(() => setLoading(false));
  }, [q]);

  useEffect(() => { load(); }, [load]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedCount = selectedIds.length;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((c) => c.id)));
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = async (dryRun) => {
    if (!selectedCount) {
      toast.error("Select at least one test clinic");
      return;
    }
    if (!dryRun) {
      if (!reason.trim()) {
        toast.error("Deletion reason is required");
        return;
      }
      if (confirmText.trim() !== CONFIRM_PHRASE) {
        toast.error(`Type "${CONFIRM_PHRASE}" to confirm`);
        return;
      }
      if (!window.confirm(`Permanently delete ${selectedCount} test clinic(s)? This cannot be undone.`)) {
        return;
      }
    }
    setBusy(true);
    try {
      const r = await api.post("/superadmin/clinics/bulk-delete-test", {
        clinic_ids: selectedIds,
        confirmation_text: dryRun ? undefined : confirmText.trim(),
        reason: dryRun ? undefined : reason.trim(),
        dry_run: dryRun,
      });
      if (dryRun) {
        setPreview(r.data);
        toast.success(`Preview: ${r.data?.selected_count || 0} clinic(s)`);
      } else {
        toast.success(`Deleted ${r.data?.deleted_count || 0} test clinic(s)`);
        setPreview(null);
        setConfirmText("");
        setReason("");
        setSelected(new Set());
        await load();
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (detail?.blocked_clinics?.length) {
        toast.error("Only test/demo clinics can be bulk-deleted");
      } else if (typeof detail === "string") {
        toast.error(detail);
      } else if (detail?.message) {
        toast.error(detail.message);
      } else {
        toast.error("Bulk operation failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl" data-testid="sa-qa-cleanup-page">
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <div className="text-xs uppercase tracking-widest" style={muted}>Platform</div>
          <h1 className="font-display text-3xl mt-2" style={{ color: "#F5F2EA" }}>QA cleanup</h1>
          <p className="text-sm mt-2 max-w-2xl" style={muted}>
            Permanently remove test/demo clinics flagged with <code className="text-xs">is_test_clinic</code>.
            Production clinics are never listed here and cannot be bulk-deleted.
          </p>
        </div>
        <Link to="/superadmin/clinics" className="text-sm" style={{ color: "#8AA992" }}>← All clinics</Link>
      </div>

      <div className="p-4 mb-6 flex gap-3 items-start" style={{ ...card, background: "#2a2418", borderColor: "#4a3d20" }}>
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#D4A373" }} />
        <div className="text-sm" style={text}>
          <strong style={{ color: "#F5F2EA" }}>Destructive action.</strong> Deletes users, patients, bookings, visits, invoices, catalogs, settings, files, and the clinic record.
          Global plan pricing, bank accounts, and platform settings are not touched.
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <SearchInput
          className="flex-1 min-w-[200px] max-w-md"
          useBlInput={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") load(); }}
          placeholder="Search test clinics…"
          inputClassName="pr-3 py-2 rounded-lg outline-none text-sm"
          style={{ background: "#141B22", border: "1px solid #2A3942", color: "#E6E8E6" }}
          data-testid="sa-qa-search"
        />
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1"
          style={{ ...card, ...text }}
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
        <span className="text-sm px-3 py-1.5 rounded-lg" style={{ background: "#1F2D34", color: "#8AA992" }} data-testid="sa-qa-selected-count">
          {selectedCount} selected
        </span>
      </div>

      <div className="rounded-2xl overflow-hidden mb-6" style={card}>
        <table className="w-full text-sm" data-testid="sa-qa-clinics-table">
          <thead style={{ background: "#1A242B" }}>
            <tr className="text-left" style={muted}>
              <th className="px-4 py-3 w-10">
                <button type="button" onClick={toggleAll} aria-label="Select all" className="p-1 rounded hover:bg-[#1F2D34]">
                  {allSelected ? <CheckSquare className="w-4 h-4" style={{ color: "#8AA992" }} /> : <Square className="w-4 h-4" />}
                </button>
              </th>
              <th className="px-4 py-3 font-medium uppercase text-xs tracking-widest">Clinic</th>
              <th className="px-4 py-3 font-medium uppercase text-xs tracking-widest">Staff</th>
              <th className="px-4 py-3 font-medium uppercase text-xs tracking-widest">Patients</th>
              <th className="px-4 py-3 font-medium uppercase text-xs tracking-widest">Bookings</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-5 py-10 text-center" style={muted}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center" style={muted}>No test clinics found. Mark clinics as test/demo from their detail page.</td></tr>
            )}
            {!loading && rows.map((c) => {
              const checked = selected.has(c.id);
              return (
                <tr key={c.id} className="border-t" style={{ borderColor: "#1F2A30" }} data-testid={`sa-qa-row-${c.slug}`}>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => toggleOne(c.id)} className="p-1 rounded hover:bg-[#1F2D34]" data-testid={`sa-qa-check-${c.slug}`}>
                      {checked ? <CheckSquare className="w-4 h-4" style={{ color: "#8AA992" }} /> : <Square className="w-4 h-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div style={{ color: "#F5F2EA" }} className="font-medium">{c.name}</div>
                    <div className="text-xs" style={muted}>/{c.slug} · {c.owner_email}</div>
                    <span className="text-[10px] uppercase tracking-wide mt-1 inline-block px-1.5 py-0.5 rounded" style={{ background: "#2a3520", color: "#B8C99A" }}>test</span>
                  </td>
                  <td className="px-4 py-3" style={text}>{c.staff_count ?? "—"}</td>
                  <td className="px-4 py-3" style={text}>{c.patient_count ?? "—"}</td>
                  <td className="px-4 py-3" style={text}>{c.booking_count ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/superadmin/clinics/${c.id}`} className="text-xs" style={{ color: "#8AA89E" }}>Detail</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="p-5 space-y-4" style={card}>
          <h2 className="font-display text-lg" style={{ color: "#F5F2EA" }}>Delete selected</h2>
          <label className="block text-xs uppercase tracking-widest" style={muted}>Reason (required for delete)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-y"
            style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}
            placeholder="e.g. QA sprint cleanup May 2026"
            data-testid="sa-qa-reason"
          />
          <label className="block text-xs uppercase tracking-widest" style={muted}>
            Type <strong style={{ color: "#F5F2EA" }}>{CONFIRM_PHRASE}</strong> to confirm
          </label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm font-mono outline-none"
            style={{ background: "#0F1419", border: "1px solid #2A3942", color: "#E6E8E6" }}
            placeholder={CONFIRM_PHRASE}
            data-testid="sa-qa-confirm-text"
          />
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() => runBulk(true)}
              disabled={busy || !selectedCount}
              className="text-sm px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
              style={{ ...card, color: "#8AA992" }}
              data-testid="sa-qa-dry-run"
            >
              <Eye className="w-4 h-4" /> Dry run preview
            </button>
            <button
              type="button"
              onClick={() => runBulk(false)}
              disabled={busy || !selectedCount}
              className="text-sm px-4 py-2 rounded-lg inline-flex items-center gap-2 text-white disabled:opacity-50"
              style={{ background: "#8B3A2A" }}
              data-testid="sa-qa-delete"
            >
              <Trash2 className="w-4 h-4" /> {busy ? "Working…" : "Delete selected"}
            </button>
          </div>
        </div>

        <div className="p-5" style={card} data-testid="sa-qa-preview-panel">
          <h2 className="font-display text-lg mb-3" style={{ color: "#F5F2EA" }}>Dry run preview</h2>
          {!preview && (
            <p className="text-sm" style={muted}>Run a dry run to see users, patients, bookings, visits, invoices, and file counts before deleting.</p>
          )}
          {preview && (
            <div className="space-y-4 text-sm">
              <div style={muted}>{preview.selected_count} clinic(s) · totals below</div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(preview.totals || {}).map(([k, v]) => (
                  <div key={k} className="px-3 py-2 rounded-lg" style={{ background: "#1A242B" }}>
                    <div className="text-xs capitalize" style={muted}>{k.replace(/_count$/, "").replace(/_/g, " ")}</div>
                    <div className="font-medium" style={{ color: "#F5F2EA" }}>{fmtNum(v)}</div>
                  </div>
                ))}
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {(preview.clinics || []).map((c) => (
                  <div key={c.id} className="p-3 rounded-lg" style={{ background: "#1A242B" }}>
                    <div className="font-medium" style={{ color: "#F5F2EA" }}>{c.name}</div>
                    <div className="text-xs" style={muted}>/{c.slug}</div>
                    <div className="text-xs mt-2 grid grid-cols-3 gap-1" style={muted}>
                      <span>Users {fmtNum(c.users_count)}</span>
                      <span>Patients {fmtNum(c.patients_count)}</span>
                      <span>Bookings {fmtNum(c.bookings_count)}</span>
                      <span>Visits {fmtNum(c.visits_count)}</span>
                      <span>Invoices {fmtNum(c.invoices_count)}</span>
                      <span>Files {fmtNum(c.files_count)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
