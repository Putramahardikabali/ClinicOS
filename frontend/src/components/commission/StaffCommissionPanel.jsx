import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import { CheckCircle2, Banknote, Download, Settings, Inbox } from "lucide-react";
import {
  COMMISSION_STATUSES,
  DATE_BASIS_OPTIONS,
  defaultDateRange,
  downloadCommissionExport,
  fmtDate,
  fmtIDR,
  summarizeRows,
} from "@/lib/commissionUtils";

const EMPTY_REASONS = [
  "No active commission rule matches this staff member or treatment",
  "Invoice line item has no performer assigned",
  "Invoice is not paid yet",
  "Treatment session is not completed, if the rule requires a completed session",
  "Current status or date filter may be hiding existing records — try All statuses and Earned date",
];

function CommissionEmptyState({ staffName, filters, canManageRules }) {
  const statusLabel = COMMISSION_STATUSES.find((s) => s.value === filters.status)?.label || filters.status;
  const basisLabel = DATE_BASIS_OPTIONS.find((o) => o.value === filters.dateBasis)?.label || filters.dateBasis;

  return (
    <div className="p-6 sm:p-8" data-testid="commission-empty-state">
      <div className="flex flex-col items-center text-center max-w-lg mx-auto">
        <div className="w-12 h-12 rounded-full bg-[#F3F1EB] flex items-center justify-center mb-4">
          <Inbox className="w-6 h-6 text-[#5C6C62]" strokeWidth={1.5} />
        </div>
        <h3 className="font-display text-lg text-[#2D3A33]">
          No commission records found for this staff.
        </h3>
        {staffName && (
          <p className="text-sm text-[#5C6C62] mt-1">{staffName}</p>
        )}
      </div>

      <div className="mt-6 max-w-xl mx-auto">
        <p className="text-sm font-medium text-[#2D3A33] mb-2">Possible reasons</p>
        <ul className="text-sm text-[#5C6C62] space-y-1.5 list-disc pl-5">
          {EMPTY_REASONS.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      <div className="mt-5 max-w-xl mx-auto rounded-lg border border-[#EAE6D7] bg-[#FAFAF7] px-4 py-3 text-xs text-[#5C6C62]">
        <div className="font-medium text-[#2D3A33] mb-1.5">Active filters</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          <span>Date range: <strong className="text-[#2D3A33]">{filters.from || "—"} → {filters.to || "—"}</strong></span>
          <span>Status: <strong className="text-[#2D3A33]">{statusLabel}</strong></span>
          <span className="sm:col-span-2">Date basis: <strong className="text-[#2D3A33]">{basisLabel}</strong></span>
        </div>
      </div>

      {canManageRules && (
        <div className="mt-6 flex justify-center">
          <Link
            to="/finance-settings?tab=commission"
            className="bl-btn-ghost text-sm inline-flex items-center gap-2"
            data-testid="commission-empty-settings-link"
          >
            <Settings className="w-4 h-4" />
            Go to Commission Settings
          </Link>
        </div>
      )}
    </div>
  );
}

export default function StaffCommissionPanel({
  staffId,
  staffName = "",
  canManage = false,
  canExport = false,
  readOnly = false,
}) {
  const manage = canManage && !readOnly;
  const exportAllowed = canExport && !readOnly;
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [dateRange, setDateRange] = useState(defaultDateRange);
  const [status, setStatus] = useState("all");
  const [dateBasis, setDateBasis] = useState("earned_at");

  const load = useCallback(async () => {
    if (!staffId) return;
    const params = {
      staff_id: staffId,
      date_basis: dateBasis,
    };
    if (dateRange.from) params.from = dateRange.from;
    if (dateRange.to) params.to = dateRange.to;
    if (status && status !== "all") params.status = status;
    const r = await api.get("/commission-records", { params });
    setRows(r.data || []);
    setSelected(new Set());
  }, [staffId, dateRange.from, dateRange.to, status, dateBasis]);

  useEffect(() => {
    load().catch(() => toast.error("Could not load commission records"));
  }, [load]);

  const summary = useMemo(() => summarizeRows(rows), [rows]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAllEarned = () => {
    const earnedIds = rows.filter((r) => r.status === "earned").map((r) => r.id);
    const allSelected = earnedIds.length > 0 && earnedIds.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(earnedIds));
  };

  const approveSelected = async () => {
    const ids = [...selected].filter((id) => rows.find((r) => r.id === id && r.status === "earned"));
    if (!ids.length) {
      toast.error("Select earned records to approve");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/commission-records/approve", { record_ids: ids });
      toast.success(`Approved ${r.data.approved} record(s)`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  const payoutSelected = async () => {
    const ids = [...selected].filter((id) => rows.find((r) => r.id === id && r.status === "approved"));
    if (!ids.length) {
      toast.error("Select approved records to mark paid out");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/commission-records/paid-out", { record_ids: ids });
      toast.success(`Marked ${r.data.paid_out} record(s) as paid out`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Payout update failed");
    } finally {
      setBusy(false);
    }
  };

  const exportStaff = async () => {
    if (!dateRange.from || !dateRange.to) {
      toast.error("Select start and end dates to export");
      return;
    }
    if (dateRange.from > dateRange.to) {
      toast.error("Start date must be on or before end date");
      return;
    }
    setExportBusy(true);
    try {
      const exportStatus = ["approved", "paid_out", "all"].includes(status) ? status : "approved";
      const qs = new URLSearchParams({
        from: dateRange.from,
        to: dateRange.to,
        staff_id: staffId,
        date_basis: dateBasis,
        status: exportStatus,
      });
      const slug = staffName ? staffName.replace(/\s+/g, "-").toLowerCase() : staffId.slice(0, 8);
      await downloadCommissionExport(
        `/commission-records/export?${qs.toString()}`,
        `commission-${slug}-${dateRange.from}-to-${dateRange.to}.xlsx`,
      );
      toast.success("Commission export downloaded");
    } catch (e) {
      toast.error(e.message || "Export failed");
    } finally {
      setExportBusy(false);
    }
  };

  const displayDate = (row) => {
    if (dateBasis === "paid_out_at") return row.paid_out_at || row.approved_at || row.created_at;
    if (dateBasis === "earned_at" || dateBasis === "invoice_paid_at") return row.created_at;
    return row.approved_at || row.created_at;
  };

  return (
    <div className="space-y-4" data-testid="staff-commission-panel">
      <div className="bl-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label-eyebrow block mb-1">Start date</label>
              <input
                type="date"
                className="bl-input text-sm"
                value={dateRange.from}
                onChange={(e) => setDateRange((r) => ({ ...r, from: e.target.value }))}
                data-testid="commission-from-date"
              />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">End date</label>
              <input
                type="date"
                className="bl-input text-sm"
                value={dateRange.to}
                onChange={(e) => setDateRange((r) => ({ ...r, to: e.target.value }))}
                data-testid="commission-to-date"
              />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Status</label>
              <select
                className="bl-input text-sm min-w-[140px]"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {COMMISSION_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-eyebrow block mb-1">Date basis</label>
              <select
                className="bl-input text-sm min-w-[160px]"
                value={dateBasis}
                onChange={(e) => setDateBasis(e.target.value)}
                data-testid="commission-date-basis"
              >
                {DATE_BASIS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          {exportAllowed && (
            <button
              type="button"
              disabled={exportBusy}
              onClick={exportStaff}
              className="bl-btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50 shrink-0"
              data-testid="export-staff-commission"
            >
              <Download className="w-4 h-4" />
              {exportBusy ? "Exporting…" : "Export commission"}
            </button>
          )}
        </div>
        <p className="text-xs text-[#5C6C62] mt-3">
          {readOnly
            ? "View-only — your commission records. Contact clinic management for approvals or payout questions."
            : "Use a custom date range for cut-off periods (e.g. 25th–25th). Export includes approved and paid out records only."}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { key: "earned", label: "Earned", value: summary.earned },
          { key: "approved", label: "Approved", value: summary.approved },
          { key: "paidOut", label: "Paid out", value: summary.paidOut },
          { key: "remainingUnpaid", label: "Remaining unpaid", value: summary.remainingUnpaid },
        ].map((card) => (
          <div key={card.key} className="bl-card p-4">
            <div className="label-eyebrow">{card.label}</div>
            <div className="font-display text-xl mt-1 text-[#2D3A33]">{fmtIDR(card.value)}</div>
          </div>
        ))}
      </div>

      {manage && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={approveSelected} className="bl-btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50">
            <CheckCircle2 className="w-4 h-4" /> Approve selected
          </button>
          <button type="button" disabled={busy} onClick={payoutSelected} className="bl-btn-ghost text-sm inline-flex items-center gap-2 disabled:opacity-50">
            <Banknote className="w-4 h-4" /> Mark paid out
          </button>
          <button type="button" onClick={toggleAllEarned} className="bl-btn-ghost text-sm">Select all earned</button>
        </div>
      )}

      <div className="bl-card overflow-hidden">
        {rows.length === 0 ? (
          <CommissionEmptyState
            staffName={staffName}
            filters={{ from: dateRange.from, to: dateRange.to, status, dateBasis }}
            canManageRules={manage}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[880px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-[#5C6C62] border-b border-[#EAE6D7] bg-[#F8F5EC]">
                  {manage && <th className="p-3 w-8" />}
                  <th className="p-3">Date</th>
                  <th className="p-3">Invoice</th>
                  <th className="p-3">Patient</th>
                  <th className="p-3">Item</th>
                  <th className="p-3 text-right">Net amount</th>
                  <th className="p-3">Rule</th>
                  <th className="p-3 text-right">Commission</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`border-b border-[#EAE6D7] ${r.needs_adjustment ? "bg-[#FFF8F0]" : ""}`}>
                    {manage && (
                      <td className="p-3">
                        {(r.status === "earned" || r.status === "approved") && (
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                        )}
                      </td>
                    )}
                    <td className="p-3 whitespace-nowrap">{fmtDate(displayDate(r))}</td>
                    <td className="p-3">
                      {readOnly ? (
                        <span className="font-mono text-xs text-[#5C6C62]">
                          {r.invoice_number_snapshot || r.invoice_id?.slice(0, 8) || "—"}
                        </span>
                      ) : (
                        <Link to={`/invoices/${r.invoice_id}`} className="underline font-mono text-xs">
                          {r.invoice_number_snapshot || r.invoice_id?.slice(0, 8)}
                        </Link>
                      )}
                    </td>
                    <td className="p-3">{r.patient?.full_name || "—"}</td>
                    <td className="p-3">{r.item_name_snapshot}</td>
                    <td className="p-3 text-right font-mono">{fmtIDR(r.net_amount)}</td>
                    <td className="p-3 text-[#5C6C62]">{r.commission_rule_name_snapshot || "—"}</td>
                    <td className="p-3 text-right font-mono font-medium">{fmtIDR(r.commission_amount)}</td>
                    <td className="p-3">
                      <span className={`bl-chip ${r.status === "paid_out" ? "success" : r.status === "earned" ? "info" : r.status === "approved" ? "success" : "warning"}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
