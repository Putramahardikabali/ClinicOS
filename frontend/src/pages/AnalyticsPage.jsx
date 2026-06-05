import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, BarChart3 } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { formatIdr } from "@/lib/clinic";
import { useAuth } from "@/lib/auth";
import { useClinic, hasFeature } from "@/lib/clinic";
import { LockedNotice } from "@/components/FeatureGate";
import { DATE_PRESETS } from "@/lib/reports";
import {
  ANALYTICS_TABS,
  buildDateParams,
  canAccessAnalytics,
  exportAnalytics,
  fetchAnalytics,
} from "@/lib/analytics";

function SummaryCard({ label, value, sub }) {
  return (
    <div className="bl-card p-4 sm:p-5">
      <div className="label-eyebrow">{label}</div>
      <div className="font-display text-xl sm:text-2xl text-[#2D3A33] mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[#5C6C62] mt-0.5">{sub}</div>}
    </div>
  );
}

function DataTable({ columns, rows, empty = "No data for this range." }) {
  if (!rows?.length) return <p className="text-sm text-[#5C6C62] py-6 text-center">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-4 py-2.5 ${c.right ? "text-right" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key ?? row.name ?? row.label ?? i} className="border-t border-[#EAE6D7]">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-2.5 text-[#2D3A33] ${c.right ? "text-right tabular-nums" : ""}`}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DisclaimerBanner({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="bl-card p-4 border-l-4 border-[#C4A962] bg-[#FFFBF0] text-sm text-[#5C6C62] space-y-1">
      {items.map((t) => <p key={t}>{t}</p>)}
    </div>
  );
}

function CompletenessBanner({ data }) {
  if (!data) return null;
  const low = (data.with_patient_source_pct ?? 0) < 70;
  return (
    <div className={`bl-card p-4 text-sm ${low ? "border-l-4 border-[#C4A962] bg-[#FFFBF0]" : "bg-[#F8F5EC]"}`}>
      <div className="label-eyebrow mb-2">Data completeness</div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <span className="text-[#5C6C62]">Nationality recorded</span>
          <div className="font-medium text-[#2D3A33]">{data.with_nationality_pct}% ({data.with_nationality} / {data.total_patients})</div>
        </div>
        <div>
          <span className="text-[#5C6C62]">Patient source recorded</span>
          <div className="font-medium text-[#2D3A33]">{data.with_patient_source_pct}% ({data.with_patient_source} / {data.total_patients})</div>
        </div>
        <div>
          <span className="text-[#5C6C62]">Both fields recorded</span>
          <div className="font-medium text-[#2D3A33]">{data.with_both_pct}% ({data.with_both} / {data.total_patients})</div>
        </div>
      </div>
      {low && (
        <p className="mt-3 text-[#8A6B1E]">
          Low source data coverage — interpret marketing metrics with caution until more patients have a recorded source.
        </p>
      )}
    </div>
  );
}

function MarketingBody({ data }) {
  const s = data.summary || {};
  return (
    <>
      <CompletenessBanner data={data.data_completeness} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="New patients" value={s.new_patients ?? 0} sub={`${s.new_patients_with_source ?? 0} with source`} />
        <SummaryCard label="Returning patients" value={s.returning_patients ?? 0} />
        <SummaryCard label="Paid revenue" value={formatIdr(s.paid_revenue_idr)} />
        <SummaryCard label="Attributed revenue" value={formatIdr(s.attributed_revenue_idr)} sub={`${formatIdr(s.unattributed_revenue_idr)} unknown`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Top 5 nationalities</div>
          <DataTable
            columns={[
              { key: "label", label: "Nationality" },
              { key: "patient_count", label: "Patients", right: true },
              { key: "pct_of_all", label: "% of all", right: true, render: (r) => `${r.pct_of_all}%` },
            ]}
            rows={data.top_nationalities}
            empty="No nationality data recorded yet."
          />
        </div>
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Patient source breakdown</div>
          <DataTable
            columns={[
              { key: "label", label: "Source" },
              { key: "patient_count", label: "Patients", right: true },
              { key: "pct_of_all", label: "% of all", right: true, render: (r) => `${r.pct_of_all}%` },
            ]}
            rows={data.patient_source_breakdown}
          />
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Revenue by patient source</div>
          <DataTable
            columns={[
              { key: "label", label: "Source" },
              { key: "revenue_idr", label: "Revenue", right: true, render: (r) => formatIdr(r.revenue_idr) },
              { key: "invoice_count", label: "Invoices", right: true },
            ]}
            rows={data.revenue_by_patient_source}
          />
        </div>
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Revenue by nationality</div>
          <DataTable
            columns={[
              { key: "label", label: "Nationality" },
              { key: "revenue_idr", label: "Revenue", right: true, render: (r) => formatIdr(r.revenue_idr) },
              { key: "invoice_count", label: "Invoices", right: true },
            ]}
            rows={data.revenue_by_nationality}
          />
        </div>
      </div>
      <div className="bl-card p-5">
        <div className="label-eyebrow mb-3">New patients by source</div>
        <DataTable
          columns={[
            { key: "label", label: "Source" },
            { key: "count", label: "New patients", right: true },
          ]}
          rows={data.new_patients_by_source}
        />
      </div>
      {data.source_detail_samples?.length > 0 && (
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-1">Source detail samples</div>
          <p className="text-xs text-[#5C6C62] mb-3">Illustrative free-text details — not verified referral data.</p>
          <DataTable
            columns={[
              { key: "patient_source", label: "Source", render: (r) => String(r.patient_source || "").replace(/_/g, " ") },
              { key: "source_detail", label: "Detail" },
              { key: "count", label: "Patients", right: true },
            ]}
            rows={data.source_detail_samples}
          />
        </div>
      )}
    </>
  );
}

function TreatmentsBody({ data }) {
  const s = data.summary || {};
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total sessions" value={s.total_sessions ?? 0} />
        <SummaryCard label="Treatment revenue" value={formatIdr(s.total_treatment_revenue_idr)} />
        <SummaryCard label="Package value delivered" value={formatIdr(s.package_delivered_value_idr)} sub="Non-cash service value" />
        <SummaryCard label="Unique treatments" value={s.unique_treatments ?? 0} />
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Top 5 by sessions</div>
          <DataTable
            columns={[
              { key: "name", label: "Treatment" },
              { key: "sessions", label: "Sessions", right: true },
              { key: "revenue_idr", label: "Revenue", right: true, render: (r) => formatIdr(r.revenue_idr) },
            ]}
            rows={data.top_by_sessions}
          />
        </div>
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Top 5 by revenue</div>
          <DataTable
            columns={[
              { key: "name", label: "Treatment" },
              { key: "revenue_idr", label: "Revenue", right: true, render: (r) => formatIdr(r.revenue_idr) },
              { key: "sessions", label: "Sessions", right: true },
            ]}
            rows={data.top_by_revenue}
          />
        </div>
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Bottom 5 by sessions</div>
          <p className="text-xs text-[#5C6C62] mb-2">Min {data.thresholds?.bottom_min_sessions ?? 2} sessions in range.</p>
          <DataTable
            columns={[
              { key: "name", label: "Treatment" },
              { key: "sessions", label: "Sessions", right: true },
              { key: "revenue_idr", label: "Revenue", right: true, render: (r) => formatIdr(r.revenue_idr) },
            ]}
            rows={data.bottom_by_sessions}
            empty="No treatments met the minimum session threshold."
          />
        </div>
      </div>
      <div className="bl-card p-5">
        <div className="label-eyebrow mb-3">Revenue by treatment</div>
        <DataTable
          columns={[
            { key: "name", label: "Treatment" },
            { key: "sessions", label: "Sessions", right: true },
            { key: "revenue_idr", label: "Cash revenue", right: true, render: (r) => formatIdr(r.revenue_idr) },
            { key: "package_value_idr", label: "Package value", right: true, render: (r) => formatIdr(r.package_value_idr) },
          ]}
          rows={data.revenue_by_treatment}
        />
      </div>
    </>
  );
}

function OperationalBody({ data }) {
  const s = data.summary || {};
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total appointments" value={s.total_appointments ?? 0} />
        <SummaryCard label="Completed" value={s.completed ?? 0} />
        <SummaryCard label="Busiest day" value={s.busiest_day || "—"} />
        <SummaryCard label="Quietest day" value={s.quietest_day || "—"} />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Appointments by day of week</div>
          <DataTable
            columns={[
              { key: "label", label: "Day" },
              { key: "count", label: "Appointments", right: true },
            ]}
            rows={data.appointments_by_day_of_week}
          />
        </div>
        <div className="bl-card p-5">
          <div className="label-eyebrow mb-3">Appointment status</div>
          <DataTable
            columns={[
              { key: "status", label: "Status", render: (r) => String(r.status || "").replace(/_/g, " ") },
              { key: "count", label: "Count", right: true },
            ]}
            rows={data.appointments_by_status}
          />
        </div>
      </div>
      <div className="bl-card p-5">
        <div className="label-eyebrow mb-3">Revenue by day of week</div>
        <p className="text-xs text-[#5C6C62] mb-3">Paid invoice revenue in clinic timezone ({data.range?.timezone || "—"}).</p>
        <DataTable
          columns={[
            { key: "label", label: "Day" },
            { key: "revenue_idr", label: "Revenue", right: true, render: (r) => formatIdr(r.revenue_idr) },
          ]}
          rows={data.revenue_by_day_of_week}
        />
      </div>
    </>
  );
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const { clinic, loading: clinicLoading } = useClinic();
  const [active, setActive] = useState("marketing");
  const [preset, setPreset] = useState("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const dateParams = useMemo(() => buildDateParams(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const tab = ANALYTICS_TABS.find((t) => t.id === active) || ANALYTICS_TABS[0];

  const load = useCallback(async () => {
    if (!tab) return;
    setLoading(true);
    setError("");
    try {
      const result = await fetchAnalytics(tab.endpoint, dateParams);
      setData(result);
    } catch (e) {
      setData(null);
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : e?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [tab, dateParams]);

  useEffect(() => {
    if (clinicLoading || !canAccessAnalytics(user)) return;
    load();
  }, [load, clinicLoading, user]);

  const handleExport = async () => {
    if (!tab?.export || !data) return;
    setExporting(true);
    try {
      await exportAnalytics(tab.export, dateParams, `${active}-analytics.xlsx`);
    } catch (e) {
      setError(e?.response?.data?.detail || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (!canAccessAnalytics(user)) {
    return <Navigate to="/" replace />;
  }

  if (clinicLoading) {
    return <div className="p-10 text-center text-[#5C6C62]">Loading analytics…</div>;
  }

  if (!hasFeature(clinic, "reports")) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-2xl mx-auto">
        <LockedNotice feature="reports" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-eyebrow">Business insights</div>
          <h1 className="font-display text-3xl sm:text-4xl text-[#2D3A33] mt-1 flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-[#52796F]" /> Analytics
          </h1>
          <p className="text-sm text-[#5C6C62] mt-1">
            Marketing, treatment, and operational summaries. Read-only.{" "}
            <Link to="/reports" className="text-[#52796F] hover:underline">View full reports</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} className="bl-btn-ghost inline-flex items-center gap-2" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button type="button" onClick={handleExport} className="bl-btn-secondary inline-flex items-center gap-2" disabled={exporting || !data}>
            <Download className="w-4 h-4" /> {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {ANALYTICS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`px-4 py-2 text-sm rounded-full transition-colors ${
              active === t.id ? "bg-[#2D3A33] text-white" : "bg-[#F3F1EB] text-[#5C6C62] hover:bg-[#EAE6D7]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label-eyebrow block mb-1">Period</label>
          <select className="bl-input" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {DATE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
        </div>
        {preset === "custom" && (
          <>
            <div>
              <label className="label-eyebrow block mb-1">From</label>
              <input type="date" className="bl-input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div>
              <label className="label-eyebrow block mb-1">To</label>
              <input type="date" className="bl-input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </>
        )}
        {data?.range && (
          <div className="text-xs text-[#5C6C62] pb-2">
            {data.range.from} — {data.range.to}
            {data.range.timezone ? ` · ${data.range.timezone}` : ""}
          </div>
        )}
      </div>

      {error && <div className="mt-4 text-sm text-[#B14A2C]">{error}</div>}

      {loading ? (
        <div className="mt-8 text-[#5C6C62]">Loading…</div>
      ) : data ? (
        <div className="mt-6 space-y-6">
          <DisclaimerBanner items={data.disclaimers} />
          {active === "marketing" && <MarketingBody data={data} />}
          {active === "treatments" && <TreatmentsBody data={data} />}
          {active === "operational" && <OperationalBody data={data} />}
        </div>
      ) : null}
    </div>
  );
}
