import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatIdr } from "@/lib/clinic";
import {
  CreditCard, FileText, CalendarCheck, Activity,
  CheckCircle2, TrendingUp, ArrowRight, RefreshCw, Wallet,
} from "lucide-react";
import SearchInput from "@/components/ui/SearchInput";

const STATUS_LABEL = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const STATUS_CHIP = {
  unpaid: "warning",
  partial: "info",
  paid: "success",
  cancelled: "muted",
  refunded: "muted",
};

const STATUS_FILTERS = ["", "unpaid", "partial", "paid"];

const DATE_PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
];

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveDateRange(preset, customDate, customDateTo) {
  const now = new Date();
  const today = toISODate(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const ys = toISODate(y);
    return { from: ys, to: ys };
  }
  if (preset === "week") {
    const start = new Date(now);
    const dow = start.getDay();
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    start.setDate(start.getDate() - mondayOffset);
    return { from: toISODate(start), to: today };
  }
  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toISODate(start), to: today };
  }
  const from = customDate || today;
  const to = customDateTo && customDateTo >= from ? customDateTo : from;
  return { from, to };
}

function Stat({ icon: Icon, label, value, accent, sub, testid, onClick, active }) {
  const className = [
    "bl-card p-5 text-left w-full transition-all duration-150",
    onClick ? "cursor-pointer border border-transparent hover:border-[#D4E8DC] hover:shadow-sm active:scale-[0.99]" : "",
    active ? "ring-2 ring-[#52796F]/25 border-[#D4E8DC]" : "",
  ].filter(Boolean).join(" ");

  const inner = (
    <>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent}`}>
          <Icon className="w-5 h-5" strokeWidth={1.6} />
        </div>
        <div className="label-eyebrow">{label}</div>
      </div>
      <div className="mt-3 font-display text-2xl sm:text-3xl text-[#2D3A33]">{value}</div>
      {sub && <div className="mt-1 text-xs text-[#5C6C62]">{sub}</div>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} data-testid={testid}>
        {inner}
      </button>
    );
  }

  return (
    <div className={className} data-testid={testid}>
      {inner}
    </div>
  );
}

const METHOD_LABEL = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  qris: "QRIS",
  gift_card: "Gift Card",
  package: "Package",
  mixed: "Mixed",
  other: "Other",
  debit_card: "Debit card",
  credit_card: "Credit card",
  e_wallet: "E-wallet",
};

function formatInvoiceDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function filterInvoicesByStatus(invoices, status) {
  if (!status) return invoices;
  if (status === "outstanding") {
    return invoices.filter((r) => r.payment_status === "unpaid" || r.payment_status === "partial");
  }
  if (status === "collected") {
    return invoices.filter((r) => r.payment_status === "paid");
  }
  return invoices.filter((r) => r.payment_status === status);
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const canEdit = ["super_admin", "fo"].includes(user?.role);
  const today = toISODate(new Date());

  const [datePreset, setDatePreset] = useState("today");
  const [date, setDate] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [status, setStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [submittedVisits, setSubmittedVisits] = useState([]);
  const [loading, setLoading] = useState(true);

  const dateRange = useMemo(
    () => resolveDateRange(datePreset, date, dateTo),
    [datePreset, date, dateTo],
  );

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), searchInput ? 300 : 0);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200 };
      if (dateRange.from === dateRange.to) params.date = dateRange.from;
      else {
        params.date_from = dateRange.from;
        params.date_to = dateRange.to;
      }
      if (paymentMethod) params.payment_method = paymentMethod;
      if (search) params.q = search;
      const requests = [api.get("/invoices", { params })];
      if (canEdit) {
        requests.push(api.get("/visits", { params: { status: "submitted" } }));
      }
      const [invRes, visitRes] = await Promise.all(requests);
      setRows(invRes.data || []);
      setSubmittedVisits(canEdit ? (visitRes?.data || []).filter((v) => v.payment_status !== "paid") : []);
    } catch {
      setRows([]);
      setSubmittedVisits([]);
    } finally {
      setLoading(false);
    }
  }, [dateRange, paymentMethod, search, canEdit]);

  useEffect(() => { load(); }, [load]);

  const displayRows = useMemo(() => filterInvoicesByStatus(rows, status), [rows, status]);

  const toggleCardFilter = (filter) => {
    setStatus((current) => (current === filter ? "" : filter));
  };

  const handlePresetChange = (presetId) => {
    setDatePreset(presetId);
    if (presetId !== "custom") return;
  };

  const summary = useMemo(() => {
    const unpaid = rows.filter((r) => r.payment_status === "unpaid").length;
    const partial = rows.filter((r) => r.payment_status === "partial").length;
    const paid = rows.filter((r) => r.payment_status === "paid").length;
    const revenue = rows
      .filter((r) => ["paid", "partial"].includes(r.payment_status))
      .reduce((s, r) => s + Number(r.amount_paid || 0), 0);
    const outstanding = rows.reduce((s, r) => s + Number(r.remaining_balance || 0), 0);
    return { unpaid, partial, paid, revenue, outstanding };
  }, [rows]);

  const unpaidVisits = useMemo(
    () => rows.filter((r) => r.payment_status === "unpaid" || r.payment_status === "partial"),
    [rows],
  );

  const dateLabel = useMemo(() => {
    if (datePreset === "today") return "today";
    if (datePreset === "yesterday") return "yesterday";
    if (datePreset === "week") return "this week";
    if (datePreset === "month") return "this month";
    if (dateRange.from === dateRange.to) {
      if (dateRange.from === today) return "today";
      return new Date(`${dateRange.from}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short", day: "numeric", month: "short",
      });
    }
    const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { day: "numeric", month: "short" });
    return `${fmt(dateRange.from)} – ${fmt(dateRange.to)}`;
  }, [datePreset, dateRange, today]);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="invoices-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-eyebrow">Front desk · Billing</div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">
            Invoices
          </h1>
          <p className="mt-2 text-[#5C6C62] max-w-xl">
            Create invoices, record payments, and track outstanding balances.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="bl-btn-ghost inline-flex items-center gap-2 text-sm disabled:opacity-50"
          data-testid="invoices-refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-8 grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat
          icon={CalendarCheck}
          label={`Unpaid ${dateLabel}`}
          value={summary.unpaid}
          accent="bg-[#FBF3DB] text-[#8A6D1F]"
          testid="inv-stat-unpaid"
          onClick={() => toggleCardFilter("unpaid")}
          active={status === "unpaid"}
        />
        <Stat
          icon={Activity}
          label={`Partial ${dateLabel}`}
          value={summary.partial}
          accent="bg-[#E5EEF5] text-[#2C5A77]"
          testid="inv-stat-partial"
          onClick={() => toggleCardFilter("partial")}
          active={status === "partial"}
        />
        <Stat
          icon={CheckCircle2}
          label={`Paid ${dateLabel}`}
          value={summary.paid}
          accent="bg-[#EDF3EF] text-[#52796F]"
          testid="inv-stat-paid"
          onClick={() => toggleCardFilter("paid")}
          active={status === "paid"}
        />
        <Stat
          icon={TrendingUp}
          label={`Collected ${dateLabel}`}
          value={formatIdr(summary.revenue)}
          accent="bg-[#F3F1EB] text-[#5C6C62]"
          testid="inv-stat-revenue"
          onClick={() => toggleCardFilter("collected")}
          active={status === "collected"}
        />
        <Stat
          icon={Wallet}
          label="Outstanding"
          value={formatIdr(summary.outstanding)}
          accent="bg-[#FBF3DB] text-[#8A6D1F]"
          sub="Balance still due"
          testid="inv-stat-outstanding"
          onClick={() => toggleCardFilter("outstanding")}
          active={status === "outstanding"}
        />
      </div>

      <div className="mt-6 bl-card p-4 sm:p-5 space-y-4" data-testid="invoices-filters">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[200px]">
            <label className="label-eyebrow block mb-1.5">Date</label>
            <div className="flex flex-wrap gap-1 bg-[#F3F1EB] rounded-xl p-1 w-fit" data-testid="invoices-date-presets">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetChange(p.id)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition whitespace-nowrap"
                  style={datePreset === p.id
                    ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }
                    : { color: "#5C6C62" }}
                  data-testid={`invoices-preset-${p.id}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {datePreset === "custom" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  type="date"
                  className="bl-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  data-testid="invoices-date"
                />
                <input
                  type="date"
                  className="bl-input"
                  value={dateTo}
                  min={date}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="invoices-date-to"
                  title="End date (optional range)"
                />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label-eyebrow block mb-1.5">Search</label>
            <SearchInput
              placeholder="Search invoice, patient, or phone…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              data-testid="invoices-search"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="label-eyebrow block mb-1.5">Payment method</label>
            <select
              className="bl-input"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              data-testid="invoices-method-filter"
            >
              <option value="">All methods</option>
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 bg-[#F3F1EB] rounded-xl p-1 w-fit" data-testid="invoices-status-tabs">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s || "all"}
              type="button"
              onClick={() => setStatus(s)}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition"
              style={status === s
                ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }
                : { color: "#5C6C62" }}
              data-testid={`invoices-status-${s || "all"}`}
            >
              {s ? STATUS_LABEL[s] : "All"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 bl-card table-card overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-[#5C6C62]">Loading invoices…</div>
        ) : displayRows.length === 0 ? (
          <div className="p-10 text-center" data-testid="invoices-empty">
            <div className="w-14 h-14 rounded-2xl bg-[#F3F1EB] flex items-center justify-center mx-auto mb-4">
              <FileText className="w-7 h-7 text-[#A89F8B]" />
            </div>
            <p className="font-medium text-[#2D3A33]">No invoices for {dateLabel}</p>
            <p className="text-sm text-[#5C6C62] mt-2 max-w-sm mx-auto">
              {status
                ? `No invoices match the selected filter on this date.`
                : "Open a treatment session from the queue or session records list to create an invoice when a patient checks out."}
            </p>
            <Link to="/visits" className="inline-block mt-4 text-sm" style={{ color: "var(--bl-primary)" }}>
              Go to session records to create invoice →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="bl-data-table w-full min-w-[880px] text-sm" data-testid="invoices-table">
              <thead className="bl-data-table-head">
                <tr>
                  <th className="px-5 py-3">Invoice</th>
                  <th className="px-5 py-3">Patient</th>
                  <th className="px-5 py-3">Session record</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Balance</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Method</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {displayRows.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-5 py-3.5 font-mono text-xs text-[#2D3A33]">{inv.invoice_number}</td>
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-[#2D3A33]">{inv.patient?.full_name || "—"}</div>
                      {inv.patient?.phone && (
                        <div className="text-xs text-[#A89F8B]">{inv.patient.phone}</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {inv.visit_id ? (
                        <Link to={`/visits/${inv.visit_id}`} className="text-xs underline text-[#52796F]">
                          {inv.visit?.visit_type || "Session record"}
                        </Link>
                      ) : (
                        <span className="text-[#A89F8B]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-[#5C6C62] whitespace-nowrap text-xs">
                      {formatInvoiceDate(inv.created_at)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium tabular-nums">{formatIdr(inv.total_amount)}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-[#5C6C62]">
                      {inv.remaining_balance > 0 ? formatIdr(inv.remaining_balance) : "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`bl-chip ${STATUS_CHIP[inv.payment_status] || "muted"}`}>
                        {STATUS_LABEL[inv.payment_status] || inv.payment_status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#5C6C62]">
                      {METHOD_LABEL[inv.payment_method] || inv.payment_method || "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        to={`/invoices/${inv.id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium"
                        style={{ color: "var(--bl-primary)" }}
                        data-testid={`open-invoice-${inv.id}`}
                      >
                        Open <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && submittedVisits.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard className="w-4 h-4" style={{ color: "var(--bl-primary)" }} />
            <div className="label-eyebrow">Submitted treatment sessions — ready for payment</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {submittedVisits.slice(0, 6).map((v) => (
              <div key={v.id} className="bl-card p-4 flex items-center justify-between gap-3 hover:border-[#D4E8DC] transition-colors">
                <div className="min-w-0">
                  <div className="font-medium text-[#2D3A33] truncate">{v.patient_name || "Patient"}</div>
                  <div className="text-xs text-[#5C6C62] mt-0.5 capitalize">
                    {v.visit_type} treatment session · submitted
                  </div>
                </div>
                <Link to={`/invoices/visit/${v.id}`} className="bl-btn-primary text-sm inline-flex items-center gap-2 shrink-0">
                  <CreditCard className="w-4 h-4" /> Collect
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {canEdit && unpaidVisits.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard className="w-4 h-4" style={{ color: "var(--bl-primary)" }} />
            <div className="label-eyebrow">Needs collection</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {unpaidVisits.slice(0, 6).map((inv) => (
              <div key={inv.id} className="bl-card p-4 flex items-center justify-between gap-3 hover:border-[#D4E8DC] transition-colors">
                <div className="min-w-0">
                  <div className="font-medium text-[#2D3A33] truncate">{inv.patient?.full_name || "Patient"}</div>
                  <div className="text-xs text-[#5C6C62] mt-0.5">
                    {inv.invoice_number} · balance {formatIdr(inv.remaining_balance)}
                  </div>
                </div>
                <Link to={`/invoices/${inv.id}`} className="bl-btn-primary text-sm inline-flex items-center gap-2 shrink-0">
                  <CreditCard className="w-4 h-4" /> Collect
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
