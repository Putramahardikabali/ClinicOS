import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuth, hasPermission } from "@/lib/auth";
import { fmtIDR, fmtDate, fmtDay } from "@/lib/patientProfile";

const SOURCE_OPTIONS = [
  { value: "all", label: "All sources" },
  { value: "invoice", label: "Invoice" },
  { value: "pos", label: "POS" },
  { value: "package", label: "Package" },
  { value: "prepaid", label: "Prepaid" },
  { value: "gift_card", label: "Gift Card" },
];

const ITEM_TYPE_OPTIONS = [
  { value: "all", label: "All types" },
  { value: "treatment", label: "Treatment" },
  { value: "package", label: "Package" },
  { value: "product", label: "Product" },
  { value: "prepaid", label: "Prepaid" },
  { value: "gift_card", label: "Gift Card" },
  { value: "custom", label: "Custom" },
  { value: "service", label: "Service" },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "paid", label: "Paid" },
  { value: "partial", label: "Partial" },
  { value: "unpaid", label: "Unpaid" },
  { value: "redeemed", label: "Redeemed" },
  { value: "usage", label: "Usage" },
];

function defaultDateFrom() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function SummaryCard({ label, value }) {
  return (
    <div className="bl-card p-4 min-w-[140px]">
      <div className="label-eyebrow">{label}</div>
      <p className="font-mono text-lg mt-1 text-[#2D3A33]">{value}</p>
    </div>
  );
}

export default function PatientSpendingHistoryPanel({ patientId, patientName }) {
  const { user } = useAuth();
  const canExport = hasPermission(user, "patient_spending.export");

  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [source, setSource] = useState("all");
  const [itemType, setItemType] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [search, setSearch] = useState("");

  const params = useMemo(() => {
    const p = { source, item_type: itemType, payment_status: paymentStatus };
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (search.trim()) p.search = search.trim();
    return p;
  }, [dateFrom, dateTo, source, itemType, paymentStatus, search]);

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const r = await api.get(`/patients/${patientId}/spending-history`, { params });
      setSummary(r.data?.summary || null);
      setRows(r.data?.rows || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load spending history");
      setSummary(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, params]);

  useEffect(() => {
    load();
  }, [load]);

  const applyLast12Months = () => {
    setDateFrom(defaultDateFrom());
    setDateTo(new Date().toISOString().slice(0, 10));
  };

  const clearDates = () => {
    setDateFrom("");
    setDateTo("");
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const r = await api.get(`/patients/${patientId}/spending-history/export`, {
        params,
        responseType: "blob",
      });
      const slug = (patientName || "patient").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `patient-spending-history-${slug || "patient"}-${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (loading && !summary) {
    return <p className="text-sm text-[#5C6C62]">Loading spending history…</p>;
  }

  return (
    <div className="space-y-5" data-testid="patient-spending-history">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label-eyebrow">Spending history</div>
          <p className="text-sm text-[#5C6C62] mt-1">Detailed purchases, redemptions, and payments for this patient.</p>
        </div>
        {canExport && (
          <button
            type="button"
            className="bl-btn-ghost text-sm inline-flex items-center gap-1"
            disabled={exporting}
            onClick={exportExcel}
            data-testid="spending-history-export"
          >
            <Download className="w-4 h-4" /> Export Excel
          </button>
        )}
      </div>

      {summary && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          <SummaryCard label="Lifetime spend" value={fmtIDR(summary.lifetime_spend_idr)} />
          <SummaryCard label="Cash paid" value={fmtIDR(summary.total_cash_paid_idr)} />
          <SummaryCard label="Invoice paid" value={fmtIDR(summary.total_invoice_paid_idr)} />
          <SummaryCard label="Outstanding" value={fmtIDR(summary.outstanding_balance_idr)} />
          <SummaryCard label="Prepaid purchased" value={fmtIDR(summary.total_prepaid_purchased_idr)} />
          <SummaryCard label="Prepaid remaining" value={fmtIDR(summary.total_prepaid_remaining_idr)} />
          <SummaryCard label="Prepaid redeemed" value={fmtIDR(summary.total_prepaid_redeemed_idr)} />
          <SummaryCard label="Last payment" value={summary.last_payment_date ? fmtDay(summary.last_payment_date) : "—"} />
        </div>
      )}

      <div className="bl-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-[#5C6C62]">From</label>
          <input type="date" className="bl-input text-sm mt-1 w-full" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[#5C6C62]">To</label>
          <input type="date" className="bl-input text-sm mt-1 w-full" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[#5C6C62]">Source</label>
          <select className="bl-input text-sm mt-1 w-full" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#5C6C62]">Item type</label>
          <select className="bl-input text-sm mt-1 w-full" value={itemType} onChange={(e) => setItemType(e.target.value)}>
            {ITEM_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#5C6C62]">Payment status</label>
          <select className="bl-input text-sm mt-1 w-full" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
            {PAYMENT_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-[#5C6C62]">Search</label>
          <input
            className="bl-input text-sm mt-1 w-full"
            placeholder="Item name or reference"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <button type="button" className="bl-btn-ghost text-xs" onClick={applyLast12Months}>Last 12 months</button>
          <button type="button" className="bl-btn-ghost text-xs" onClick={clearDates}>All dates</button>
        </div>
      </div>

      {loading && <p className="text-sm text-[#5C6C62]">Refreshing…</p>}

      {!loading && rows.length === 0 && (
        <div className="bl-card p-8 text-center text-sm text-[#5C6C62]">No spending history found for this patient.</div>
      )}

      {rows.length > 0 && (
        <>
          <div className="hidden md:block bl-card table-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[#5C6C62] border-b border-[#EAE6D7]">
                  <th className="p-3 font-medium">Date</th>
                  <th className="p-3 font-medium">Source</th>
                  <th className="p-3 font-medium">Reference</th>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">Item</th>
                  <th className="p-3 font-medium">Session</th>
                  <th className="p-3 font-medium text-right">Qty</th>
                  <th className="p-3 font-medium text-right">Unit</th>
                  <th className="p-3 font-medium">Discount</th>
                  <th className="p-3 font-medium text-right">Total</th>
                  <th className="p-3 font-medium">Payment</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Staff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[#F3F1EB] last:border-0">
                    <td className="p-3 whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="p-3">{r.source_label || r.source}</td>
                    <td className="p-3 font-mono text-xs">{r.reference_number || "—"}</td>
                    <td className="p-3">{r.item_type_label || r.item_type}</td>
                    <td className="p-3 max-w-[200px]">{r.item_name}</td>
                    <td className="p-3 whitespace-nowrap">{r.session_date ? fmtDay(r.session_date) : "—"}</td>
                    <td className="p-3 text-right">{r.quantity}</td>
                    <td className="p-3 text-right font-mono">{fmtIDR(r.unit_price_idr)}</td>
                    <td className="p-3 text-xs text-[#5C6C62] max-w-[120px]">{r.discount_label || (r.discount_idr ? fmtIDR(r.discount_idr) : "—")}</td>
                    <td className="p-3 text-right font-mono">{fmtIDR(r.line_total_idr)}</td>
                    <td className="p-3">{r.payment_method || "—"}</td>
                    <td className="p-3 capitalize">{r.payment_status || "—"}</td>
                    <td className="p-3 text-xs">{r.staff_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="bl-card p-4 text-sm space-y-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{r.item_name}</span>
                  <span className="font-mono">{fmtIDR(r.line_total_idr)}</span>
                </div>
                <div className="text-xs text-[#5C6C62]">
                  {fmtDate(r.date)} · {r.source_label || r.source} · {r.reference_number || "—"}
                </div>
                <div className="text-xs capitalize">
                  {r.item_type_label} · {r.payment_status}
                  {r.payment_method ? ` · ${r.payment_method}` : ""}
                </div>
                {r.session_date && <div className="text-xs">Session: {fmtDay(r.session_date)}</div>}
                {r.staff_name && <div className="text-xs">Staff: {r.staff_name}</div>}
                {r.notes && <div className="text-xs text-[#5C6C62]">{r.notes}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
