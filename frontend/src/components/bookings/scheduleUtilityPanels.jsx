import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { formatIdr } from "@/lib/clinic";
import { hasPermission, useAuth } from "@/lib/auth";
import { ScheduleInvoiceDrawerDetail } from "@/components/bookings/ScheduleInvoiceDrawerDetail";
import { ScheduleSessionDrawerDetail } from "@/components/bookings/ScheduleSessionDrawerDetail";
import WaitingListPanel from "@/components/bookings/WaitingListPanel";
import {
  DATE_PRESETS,
  SESSION_STATUS_FILTERS,
  SESSION_TYPE_FILTERS,
  filterScheduleSessions,
  formatSessionTime,
  resolveDateRange,
  sessionPaymentLabel,
  sessionStatusChip,
  sessionTreatmentLabel,
  visitTypeLabel,
} from "@/lib/scheduleSessionsDrawer";
import PosNewSaleTab from "@/components/pos/PosNewSaleTab";
import PosDrawerErrorBoundary from "@/components/pos/PosDrawerErrorBoundary";
import {
  INDICATOR_DEFS,
  INDICATOR_PRIORITY,
  SCHEDULE_STATUS_COLORS,
} from "@/components/bookings/scheduleBookingIndicators";
import {
  AlertTriangle,
  Award,
  ExternalLink,
  MessageSquare,
  Package,
  Repeat,
  Sparkles,
  Heart,
} from "lucide-react";

const ICON_MAP = {
  profile_alert: AlertTriangle,
  booking_note: MessageSquare,
  specific_staff_request: Heart,
  package_use: Package,
  loyalty: Award,
  new_patient: Sparkles,
  recurring_patient: Repeat,
};

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

function SearchInput({ value, onChange, placeholder }) {
  return (
    <input
      type="search"
      className="bl-input w-full text-sm mb-3"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function StatusPill({ active }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
        active ? "bg-[#E3F1E8] text-[#2C7755]" : "bg-[#F0EBEB] text-[#6B5555]"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function PriceCheckerPanel() {
  const [tab, setTab] = useState("treatments");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    const path =
      tab === "treatments"
        ? "/treatments-catalog"
        : tab === "packages"
          ? "/packages-catalog"
          : "/products-catalog";
    const params = q.trim() ? { q: q.trim() } : {};
    api
      .get(path, { params })
      .then((r) => setRows(Array.isArray(r.data) ? r.data : r.data?.items || []))
      .catch(() => {
        setRows([]);
        setError("Could not load catalog");
      })
      .finally(() => setLoading(false));
  }, [tab, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const tabs = [
    { key: "treatments", label: "Treatments" },
    { key: "packages", label: "Packages" },
    { key: "products", label: "Products" },
  ];

  const catalogLink =
    tab === "treatments" ? "/treatments" : tab === "packages" ? "/packages" : "/products";

  return (
    <PanelShell
      title="Price checker"
      footer={<OpenPageLink to={catalogLink} label="Open catalog page" />}
    >
      <div className="flex gap-1 mb-3 p-0.5 bg-[#F3F1EB] rounded-lg">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium ${
              tab === t.key ? "bg-white text-[#2D3A33] shadow-sm" : "text-[#5C6C62]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Search…" />
      {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
      {error && <p className="text-sm text-[#B14A2C]">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-[#5C6C62]">No items found.</p>
      )}
      <div className="space-y-2">
        {rows.slice(0, 80).map((row) => (
          <div
            key={row.id || row.name}
            className="rounded-lg border border-[#EAE6D7] px-3 py-2 text-sm bg-white"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-[#2D3A33] truncate">{row.name}</div>
              <StatusPill active={row.active !== false && row.is_active !== false} />
            </div>
            {tab === "treatments" && (
              <div className="text-xs text-[#5C6C62] mt-1">
                {row.category || "—"} · {row.duration_min || 30}m · {formatIdr(row.price_idr)}
              </div>
            )}
            {tab === "packages" && (
              <div className="text-xs text-[#5C6C62] mt-1">
                {row.sessions_total ? `${row.sessions_total} sessions` : "Package"}
                {row.validity_days ? ` · ${row.validity_days}d validity` : ""}
                {" · "}
                {formatIdr(row.price_idr)}
              </div>
            )}
            {tab === "products" && (
              <div className="text-xs text-[#5C6C62] mt-1">
                {[row.product_code, row.brand].filter(Boolean).join(" · ") || row.category || "—"}
                {" · "}
                {formatIdr(row.amount ?? row.price_idr)}
                {row.current_stock != null ? ` · Stock ${row.current_stock}` : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

const PAYMENT_FILTERS = [
  { key: "", label: "All" },
  { key: "unpaid", label: "Unpaid" },
  { key: "partial", label: "Partial" },
  { key: "paid", label: "Paid" },
];

export function InvoicesPanel({
  scheduleDate,
  invoiceInit,
  onPaymentSuccess,
  onDirtyChange: onDirtyChangeProp,
}) {
  const { user } = useAuth();
  const canCreateInvoice = hasPermission(user, "billing.create") || hasPermission(user, "billing.edit");
  const [mode, setMode] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [detailDirty, setDetailDirty] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!invoiceInit) return;
    if (invoiceInit.invoiceId) {
      setSelectedId(invoiceInit.invoiceId);
      setMode("detail");
      return;
    }
    if (invoiceInit.visitId && !invoiceInit.invoiceId) {
      setSelectedId(null);
      setMode("detail");
    }
  }, [invoiceInit]);

  const load = useCallback(() => {
    setLoading(true);
    const params = { date: scheduleDate, limit: 80 };
    if (status) params.status = status;
    if (q.trim()) params.q = q.trim();
    api
      .get("/invoices", { params })
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [scheduleDate, status, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q, listRefreshKey]);

  const handlePaymentSuccess = () => {
    setListRefreshKey((k) => k + 1);
    onPaymentSuccess?.();
  };

  const openDetail = (invoiceId) => {
    setSelectedId(invoiceId);
    setMode("detail");
  };

  const backToList = () => {
    if (detailDirty && !window.confirm("Discard unsaved changes?")) return;
    setDetailDirty(false);
    setMode("list");
    setSelectedId(null);
    setListRefreshKey((k) => k + 1);
  };

  if (mode === "detail") {
    return (
      <ScheduleInvoiceDrawerDetail
        invoiceId={selectedId}
        visitId={selectedId ? undefined : invoiceInit?.visitId}
        canCreateInvoice={canCreateInvoice}
        onBack={backToList}
        onPaymentSuccess={handlePaymentSuccess}
        onDirtyChange={(dirty) => {
          setDetailDirty(dirty);
          onDirtyChangeProp?.(dirty);
        }}
      />
    );
  }

  return (
    <PanelShell title="Invoices" footer={<OpenPageLink to="/invoices" label="Open Invoices page" />}>
      <SearchInput value={q} onChange={setQ} placeholder="Patient, phone, or invoice #" />
      <div className="flex flex-wrap gap-1.5 mb-3">
        {PAYMENT_FILTERS.map((f) => (
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
      {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-[#5C6C62]">No invoices for this date.</p>
      )}
      <div className="space-y-2" data-testid="schedule-invoice-list">
        {rows.map((inv) => (
          <button
            key={inv.id}
            type="button"
            onClick={() => openDetail(inv.id)}
            className="w-full text-left rounded-lg border border-[#EAE6D7] px-3 py-2 hover:bg-[#F8F5EC] transition"
            data-testid={`schedule-invoice-card-${inv.id}`}
          >
            <div className="flex justify-between gap-2 text-sm">
              <span className="font-medium text-[#2D3A33] truncate">
                {inv.invoice_number || inv.id?.slice(0, 8)}
              </span>
              <span className="text-[#5C6C62] capitalize shrink-0">{inv.payment_status}</span>
            </div>
            <div className="text-xs text-[#5C6C62] mt-0.5 truncate">
              {inv.patient_name || inv.patient?.full_name || "—"} · {formatIdr(inv.total_amount)}
            </div>
            <div className="text-[10px] text-[#A89F8B] mt-0.5">
              {(inv.created_at || "").slice(0, 16).replace("T", " ")}
            </div>
          </button>
        ))}
      </div>
    </PanelShell>
  );
}

export function SessionsPanel({ scheduleDate, sessionsInit }) {
  const { user } = useAuth();
  const canFilterPerformer = hasPermission(user, "visits.view");
  const [mode, setMode] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [performerFilter, setPerformerFilter] = useState("");
  const [datePreset, setDatePreset] = useState("schedule");
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [patientScopeId, setPatientScopeId] = useState("");

  useEffect(() => {
    if (!sessionsInit) return;
    if (sessionsInit.visitId) {
      setSelectedId(sessionsInit.visitId);
      setMode("detail");
      return;
    }
    setMode("list");
    setSelectedId(null);
    setPatientScopeId(sessionsInit.patientId || "");
    setDatePreset("schedule");
  }, [sessionsInit]);

  const dateRange = useMemo(
    () => resolveDateRange(datePreset, scheduleDate),
    [datePreset, scheduleDate],
  );

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (status) params.status = status;
    if (performerFilter && canFilterPerformer) params.assigned_to = performerFilter;
    if (patientScopeId) params.patient_id = patientScopeId;
    return api
      .get("/visits", { params })
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [status, performerFilter, canFilterPerformer, patientScopeId]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    if (!canFilterPerformer) return;
    api
      .get("/users")
      .then((r) => {
        const list = (r.data || []).filter((u) => ["doctor", "therapist", "nurse"].includes(u.role));
        setUsers(list);
      })
      .catch(() => setUsers([]));
  }, [canFilterPerformer]);

  const filtered = useMemo(
    () => filterScheduleSessions(rows, {
      q,
      typeFilter,
      fromDate: dateRange.from,
      toDate: dateRange.to,
    }),
    [rows, q, typeFilter, dateRange],
  );

  const openDetail = (visitId) => {
    setSelectedId(visitId);
    setMode("detail");
  };

  const backToList = () => {
    setMode("list");
    setSelectedId(null);
  };

  if (mode === "detail" && selectedId) {
    return (
      <ScheduleSessionDrawerDetail
        visitId={selectedId}
        onBack={backToList}
      />
    );
  }

  return (
    <PanelShell title="Sessions" footer={<OpenPageLink to="/visits" label="Open Treatment Sessions page" />}>
      <SearchInput value={q} onChange={setQ} placeholder="Patient name or phone" />
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
            data-testid={`session-date-preset-${p.key}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-[#A89F8B] mb-3">
        {dateRange.from === dateRange.to ? dateRange.from : `${dateRange.from} – ${dateRange.to}`}
      </p>
      <div className="mb-3">
        <div className="text-[10px] uppercase text-[#A89F8B] mb-1.5">Status</div>
        <div className="flex flex-wrap gap-1.5">
          {SESSION_STATUS_FILTERS.map((f) => (
            <button
              key={f.key || "all-status"}
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
      </div>
      {canFilterPerformer && (
        <div className="mb-3">
          <label className="text-[10px] uppercase text-[#A89F8B] block mb-1">Staff</label>
          <select
            className="bl-input w-full text-sm"
            value={performerFilter}
            onChange={(e) => setPerformerFilter(e.target.value)}
            data-testid="schedule-session-staff-filter"
          >
            <option value="">All staff</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </select>
        </div>
      )}
      <div className="mb-3">
        <div className="text-[10px] uppercase text-[#A89F8B] mb-1.5">Type</div>
        <div className="flex flex-wrap gap-1.5">
          {SESSION_TYPE_FILTERS.map((f) => (
            <button
              key={f.key || "all-type"}
              type="button"
              onClick={() => setTypeFilter(f.key)}
              className={`text-xs px-2.5 py-1 rounded-full border ${
                typeFilter === f.key
                  ? "border-[#52796F] bg-[#EDF3EF] text-[#2C7755]"
                  : "border-[#EAE6D7] text-[#5C6C62]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p className="text-sm text-[#5C6C62]">No sessions match your filters.</p>
      )}
      <div className="space-y-2" data-testid="schedule-session-list">
        {filtered.map((v) => {
          const treatment = sessionTreatmentLabel(v);
          const payment = sessionPaymentLabel(v);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => openDetail(v.id)}
              className="w-full text-left rounded-lg border border-[#EAE6D7] px-3 py-2 hover:bg-[#F8F5EC] transition"
              data-testid={`schedule-session-card-${v.id}`}
            >
              <div className="font-medium text-sm text-[#2D3A33] truncate">{v.patient_name}</div>
              <div className="text-xs text-[#5C6C62] mt-0.5 truncate">
                {visitTypeLabel(v.visit_type)}
                {treatment ? ` · ${treatment}` : ""}
              </div>
              <div className="text-xs text-[#5C6C62] mt-0.5 truncate">
                {v.assigned_user_name || "Unassigned"} · {formatSessionTime(v)}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <span className={`bl-chip text-[10px] py-0.5 px-1.5 ${sessionStatusChip(v.status)}`}>
                  {(v.status || "").replace("_", " ")}
                </span>
                <span className={`bl-chip text-[10px] py-0.5 px-1.5 ${payment.chip}`}>
                  {payment.label}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </PanelShell>
  );
}

export function PosTodaySummary({ refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get("/pos/sales/today")
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const summary = data?.summary || {};
  const items = data?.items || [];

  if (loading) return <p className="text-sm text-[#5C6C62]">Loading…</p>;
  if (!data) {
    return <p className="text-sm text-[#5C6C62]">POS summary unavailable. Use Open POS to continue.</p>;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
        <div className="rounded-lg bg-[#F8F5EC] px-3 py-2">
          <div className="text-[10px] uppercase text-[#A89F8B]">Today sales</div>
          <div className="font-semibold text-[#2D3A33]">{summary.transaction_count ?? items.length}</div>
        </div>
        <div className="rounded-lg bg-[#F8F5EC] px-3 py-2">
          <div className="text-[10px] uppercase text-[#A89F8B]">Collected</div>
          <div className="font-semibold text-[#2D3A33]">{formatIdr(summary.total_collected_idr)}</div>
        </div>
      </div>
      <p className="text-xs text-[#A89F8B] mb-2">Recent sales today</p>
      <div className="space-y-2">
        {items.slice(0, 15).map((sale) => (
          <div key={sale.id} className="rounded-lg border border-[#EAE6D7] px-3 py-2 text-sm">
            <div className="font-medium text-[#2D3A33]">{sale.customer_display || "Walk-in"}</div>
            <div className="text-xs text-[#5C6C62]">
              {formatIdr(sale.total)} · {(sale.paid_at || "").slice(11, 16)}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-[#5C6C62]">No POS sales today.</p>}
      </div>
    </>
  );
}

export function PosPanel() {
  const { user } = useAuth();
  const canCreate = hasPermission(user, "pos.create");
  const [summaryKey, setSummaryKey] = useState(0);
  const [section, setSection] = useState(() => (canCreate ? "sale" : "summary"));

  return (
    <PanelShell
      title="POS"
      footer={
        <div className="flex flex-col gap-2">
          <OpenPageLink to="/pos" label="Open full POS" />
          <OpenPageLink to="/pos" label="Open POS in new tab" />
        </div>
      }
    >
      {canCreate && (
        <div className="flex gap-1 mb-3 p-0.5 bg-[#F3F1EB] rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => setSection("sale")}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium ${
              section === "sale" ? "bg-white text-[#2D3A33] shadow-sm" : "text-[#5C6C62]"
            }`}
            data-testid="pos-drawer-quick-sale-tab"
          >
            Quick sale
          </button>
          <button
            type="button"
            onClick={() => setSection("summary")}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium ${
              section === "summary" ? "bg-white text-[#2D3A33] shadow-sm" : "text-[#5C6C62]"
            }`}
            data-testid="pos-drawer-summary-tab"
          >
            Today
          </button>
        </div>
      )}
      {section === "sale" && canCreate ? (
        <PosDrawerErrorBoundary>
          <PosNewSaleTab
            compact
            onSaleCompleted={() => {
              setSummaryKey((k) => k + 1);
              setSection("summary");
            }}
          />
        </PosDrawerErrorBoundary>
      ) : (
        <PosTodaySummary refreshKey={summaryKey} />
      )}
    </PanelShell>
  );
}

export function DailyClosingPanel({ scheduleDate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get("/closing/preview", { params: { date: scheduleDate } })
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [scheduleDate]);

  const methods = data?.payment_methods || {};

  return (
    <PanelShell
      title="Daily closing"
      footer={<OpenPageLink to="/daily-closing" label="Open Daily Closing page" />}
    >
      {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
      {!loading && data && (
        <>
          <div className="flex items-center gap-2 mb-4">
            <span
              className={`text-xs font-semibold uppercase px-2 py-1 rounded ${
                data.is_closed ? "bg-[#E8E6E0] text-[#4A4843]" : "bg-[#E3F1E8] text-[#2C7755]"
              }`}
            >
              {data.is_closed ? "Closed" : "Open"}
            </span>
            {data.closed_at && (
              <span className="text-xs text-[#5C6C62]">
                Last closed {new Date(data.closed_at).toLocaleString()}
              </span>
            )}
          </div>
          <div className="rounded-lg bg-[#F8F5EC] px-3 py-3 mb-4">
            <div className="text-[10px] uppercase text-[#A89F8B]">Collected today</div>
            <div className="text-xl font-display text-[#2D3A33]">{formatIdr(data.money_collected_idr)}</div>
          </div>
          <div className="space-y-1.5 text-sm">
            {[
              ["Cash", methods.cash],
              ["Card", methods.card],
              ["QRIS", methods.qris],
              ["Transfer", methods.bank_transfer],
            ].map(([label, amt]) => (
              <div key={label} className="flex justify-between text-[#5C6C62]">
                <span>{label}</span>
                <span className="font-medium text-[#2D3A33]">{formatIdr(amt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {!loading && !data && (
        <p className="text-sm text-[#5C6C62]">Closing summary unavailable.</p>
      )}
    </PanelShell>
  );
}

const LOG_ACTIONS = [
  { key: "", label: "All actions" },
  { key: "created", label: "Created" },
  { key: "rescheduled", label: "Rescheduled" },
  { key: "moved", label: "Moved" },
  { key: "duration_changed", label: "Duration changed" },
  { key: "reassigned", label: "Staff reassigned" },
  { key: "cancelled", label: "Cancelled" },
  { key: "status_change", label: "Status change" },
  { key: "start_visit", label: "Session started" },
  { key: "performer_added", label: "Staff added" },
  { key: "performer_removed", label: "Staff removed" },
  { key: "note_updated", label: "Note updated" },
  { key: "staff_request_override", label: "Staff request override" },
  { key: "overlap_override", label: "Overlap override" },
];

function shiftDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const LOG_QUICK_RANGES = [
  { key: "today", label: "Today", offsetFrom: 0, offsetTo: 0 },
  { key: "yesterday", label: "Yesterday", offsetFrom: -1, offsetTo: -1 },
  { key: "last7", label: "Last 7 days", offsetFrom: -6, offsetTo: 0 },
  { key: "last30", label: "Last 30 days", offsetFrom: -29, offsetTo: 0 },
];

function formatLogAction(row) {
  const action = row.action || "";
  const mod = row.module || row.entity || "";
  const labels = {
    created: mod === "booking" ? "Blocked time created" : "Appointment created",
    rescheduled: "Rescheduled",
    moved: "Moved on schedule",
    duration_changed: "Duration changed",
    reassigned: "Staff reassigned",
    cancelled: "Appointment cancelled",
    cancel: "Appointment cancelled",
    status_change: row.new_value?.status
      ? `Status → ${row.new_value.status}`
      : (row.meta?.to ? `Status → ${row.meta.to}` : "Status changed"),
    start_visit: "Treatment session started",
    performer_added: "Staff added",
    performer_removed: "Staff removed",
    note_updated: "Booking note updated",
    staff_request_override: "Staff request override",
    overlap_override: "Overlap override",
    schedule_changed: "Schedule changed",
  };
  if (labels[action]) return labels[action];
  if (mod === "schedule") return `Schedule · ${action.replace(/_/g, " ")}`;
  return action.replace(/_/g, " ");
}

function logReference(row) {
  const nv = row.new_value || {};
  const ov = row.old_value || {};
  return (
    nv.patient_name
    || ov.patient_name
    || nv.treatment
    || row.booking_patient_name
    || row.record_id?.slice(0, 8)
    || "—"
  );
}

export function AppointmentLogPanel({ scheduleDate }) {
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [dateFrom, setDateFrom] = useState(scheduleDate);
  const [dateTo, setDateTo] = useState(scheduleDate);
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setDateFrom(scheduleDate);
    setDateTo(scheduleDate);
  }, [scheduleDate]);

  useEffect(() => {
    api.get("/users").then((r) => setStaff(r.data || [])).catch(() => setStaff([]));
  }, []);

  const applyQuickRange = (range) => {
    setDateFrom(shiftDateStr(scheduleDate, range.offsetFrom));
    setDateTo(shiftDateStr(scheduleDate, range.offsetTo));
  };

  const load = useCallback(() => {
    setLoading(true);
    const params = { date_from: dateFrom, date_to: dateTo, limit: 150 };
    if (action) params.action = action;
    if (userId) params.user_id = userId;
    if (q.trim()) params.q = q.trim();
    api
      .get("/bookings/appointment-log", { params })
      .then((r) => setRows(r.data?.items || r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, action, userId, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <PanelShell title="Appointment log">
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="text-xs text-[#5C6C62]">
          From
          <input
            type="date"
            className="bl-input text-sm mt-1 w-full"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            data-testid="appointment-log-date-from"
          />
        </label>
        <label className="text-xs text-[#5C6C62]">
          To
          <input
            type="date"
            className="bl-input text-sm mt-1 w-full"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            data-testid="appointment-log-date-to"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {LOG_QUICK_RANGES.map((range) => (
          <button
            key={range.key}
            type="button"
            onClick={() => applyQuickRange(range)}
            className="text-xs px-2.5 py-1 rounded-full border border-[#EAE6D7] text-[#5C6C62] hover:bg-[#F8F5EC]"
            data-testid={`appointment-log-range-${range.key}`}
          >
            {range.label}
          </button>
        ))}
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Search patient…" />
      <div className="grid grid-cols-2 gap-2 mb-3">
        <select className="bl-input text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
          {LOG_ACTIONS.map((a) => (
            <option key={a.key || "all"} value={a.key}>{a.label}</option>
          ))}
        </select>
        <select className="bl-input text-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">All staff</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </div>
      {loading && <p className="text-sm text-[#5C6C62]">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-[#5C6C62]">No appointment activity in this date range.</p>
      )}
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-[#EAE6D7] px-3 py-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-medium text-[#2D3A33]">{formatLogAction(row)}</span>
              <span className="text-[10px] text-[#A89F8B] shrink-0">
                {(row.created_at || "").slice(0, 10)} {(row.created_at || "").slice(11, 16)}
              </span>
            </div>
            <div className="text-xs text-[#5C6C62] mt-0.5">
              {row.user_name || row.user_email || "System"} · {logReference(row)}
            </div>
            {(row.old_value || row.new_value) && (
              <div className="text-[10px] text-[#A89F8B] mt-1 line-clamp-2">
                {row.old_value?.scheduled_at && `Was ${row.old_value.scheduled_at.slice(0, 16)}`}
                {row.new_value?.scheduled_at && ` → ${row.new_value.scheduled_at.slice(0, 16)}`}
              </div>
            )}
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

const LEGEND_STATUSES = [
  "booked",
  "confirmed",
  "checked_in",
  "treatment_started",
  "closed",
  "completed",
  "cancelled",
  "no_show",
  "unavailable",
  "block_out",
];

export function LegendPanel() {
  return (
    <PanelShell title="Schedule legend">
      <p className="text-xs font-medium text-[#5C6C62] mb-2">Status colors</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2 mb-5">
        {LEGEND_STATUSES.map((key) => {
          const v = SCHEDULE_STATUS_COLORS[key];
          if (!v) return null;
          return (
            <div key={key} className="flex items-center gap-1.5 text-xs min-w-0">
              <span
                className={`w-3.5 h-3.5 rounded-sm border shrink-0 ${key === "block_out" ? "border-dashed" : ""}`}
                style={{ background: v.bg, borderColor: v.border }}
              />
              <span className="text-[#2D3A33] truncate">{v.label}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <span className="w-3.5 h-3.5 rounded-sm bg-[#EDE8DC]/70 border border-[#D8D0C0] shrink-0" />
          <span className="text-[#2D3A33] truncate">Past time</span>
        </div>
      </div>
      <p className="text-xs font-medium text-[#5C6C62] mb-2">Card icons (max 3 on card)</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {INDICATOR_PRIORITY.map((key) => {
          const def = INDICATOR_DEFS[key];
          const Icon = ICON_MAP[key] || def?.Icon;
          if (!def || !Icon) return null;
          return (
            <div key={key} className="flex items-center gap-1.5 text-xs min-w-0">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#F3F1EB] shrink-0">
                <Icon className="w-3 h-3 text-[#5C6C62]" />
              </span>
              <span className="text-[#2D3A33] truncate">{def.title}</span>
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}

export function ScheduleUtilityPanel({
  utilityId,
  scheduleDate,
  invoiceInit,
  sessionsInit,
  onPaymentSuccess,
  onCreateAppointmentFromWaitlist,
  closeGuardRef,
}) {
  const invoiceDirtyRef = useRef(false);

  useEffect(() => {
    if (!closeGuardRef) return undefined;
    closeGuardRef.current = () => {
      if (utilityId === "invoices" && invoiceDirtyRef.current) {
        return window.confirm("Discard unsaved changes?");
      }
      return true;
    };
    return () => {
      if (closeGuardRef) closeGuardRef.current = null;
    };
  }, [utilityId, closeGuardRef]);

  switch (utilityId) {
    case "price_checker":
      return <PriceCheckerPanel />;
    case "invoices":
      return (
        <InvoicesPanel
          scheduleDate={scheduleDate}
          invoiceInit={invoiceInit}
          onPaymentSuccess={onPaymentSuccess}
          onDirtyChange={(dirty) => {
            invoiceDirtyRef.current = dirty;
          }}
        />
      );
    case "pos":
      return <PosPanel />;
    case "sessions":
      return (
        <SessionsPanel
          scheduleDate={scheduleDate}
          sessionsInit={sessionsInit}
        />
      );
    case "waiting_list":
      return (
        <WaitingListPanel
          scheduleDate={scheduleDate}
          onCreateAppointment={onCreateAppointmentFromWaitlist}
        />
      );
    case "daily_closing":
      return <DailyClosingPanel scheduleDate={scheduleDate} />;
    case "appointment_log":
      return <AppointmentLogPanel scheduleDate={scheduleDate} />;
    case "legend":
      return <LegendPanel />;
    default:
      return null;
  }
}
