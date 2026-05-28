import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { formatIdr } from "@/lib/clinic";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Activity, Calendar, BarChart3 } from "lucide-react";

const RANGES = [
  { key: 6, label: "6 months" },
  { key: 12, label: "12 months" },
  { key: 24, label: "24 months" },
];

const CHART_TYPES = [
  { key: "line", label: "Line", icon: Activity },
  { key: "bar", label: "Bar", icon: BarChart3 },
];

const fmtShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return "Rp " + (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + "M";
  if (v >= 1_000) return "Rp " + (v / 1_000).toFixed(0) + "K";
  return "Rp " + v.toLocaleString("id-ID");
};

const monthLabel = (ym) => {
  // ym like "2026-05" -> "May 2026"
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
};

export default function ReportsPage() {
  const [months, setMonths] = useState(12);
  const [chartType, setChartType] = useState("line");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true); setError("");
    api.get("/reports/revenue-monthly", { params: { months } })
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.detail || "Failed to load report"))
      .finally(() => setLoading(false));
  }, [months]);

  const chartData = useMemo(() => {
    return (data?.months || []).map(m => ({ label: monthLabel(m.month), revenue: m.revenue, items: m.items }));
  }, [data]);

  const peakMonth = useMemo(() => {
    if (!chartData.length) return null;
    return chartData.reduce((a, b) => b.revenue > a.revenue ? b : a);
  }, [chartData]);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto" data-testid="reports-page">
      <div className="label-eyebrow">Insights</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Revenue analytics</h1>
      <p className="mt-2 text-[#5C6C62]">Track monthly revenue trends and clinic performance over time.</p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-[#F3F1EB] rounded-xl p-1" data-testid="range-tabs">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setMonths(r.key)} className="px-4 py-1.5 rounded-lg text-sm font-medium" style={months === r.key ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: "#5C6C62" }} data-testid={`range-${r.key}`}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-[#F3F1EB] rounded-xl p-1" data-testid="chart-toggle">
          {CHART_TYPES.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => setChartType(t.key)} className="px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5" style={chartType === t.key ? { background: "white", color: "#2D3A33", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" } : { color: "#5C6C62" }} data-testid={`chart-${t.key}`}>
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mt-6 bl-card p-5 text-[#B14A2C]" data-testid="reports-error">{error}</div>
      )}

      {!error && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard
            label="Total revenue"
            value={data ? formatIdr(data.total_revenue) : "—"}
            sub={`Across ${months} months`}
            icon={TrendingUp}
            testid="card-total"
          />
          <SummaryCard
            label="Monthly average"
            value={data ? formatIdr(data.average_monthly) : "—"}
            sub="Mean revenue per month"
            icon={BarChart3}
            testid="card-avg"
          />
          <SummaryCard
            label="Peak month"
            value={peakMonth ? formatIdr(peakMonth.revenue) : "—"}
            sub={peakMonth ? peakMonth.label : "—"}
            icon={Calendar}
            testid="card-peak"
          />
        </div>
      )}

      {!error && (
        <div className="mt-6 bl-card p-5" data-testid="reports-chart-card">
          <div className="font-display text-lg text-[#2D3A33] mb-4">Revenue by month</div>
          {loading ? (
            <div className="text-[#5C6C62] py-10 text-center">Loading…</div>
          ) : chartData.length === 0 ? (
            <div className="text-[#5C6C62] py-10 text-center">No data yet.</div>
          ) : (
            <div style={{ width: "100%", height: 360 }} data-testid="revenue-chart">
              <ResponsiveContainer>
                {chartType === "line" ? (
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" />
                    <XAxis dataKey="label" tick={{ fill: "#5C6C62", fontSize: 12 }} />
                    <YAxis tickFormatter={fmtShort} tick={{ fill: "#5C6C62", fontSize: 12 }} width={70} />
                    <Tooltip
                      formatter={(value) => formatIdr(value)}
                      contentStyle={{ background: "white", border: "1px solid #EAE6D7", borderRadius: 12, fontFamily: "inherit" }}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#52796F" strokeWidth={2.5} dot={{ fill: "#52796F", r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" />
                    <XAxis dataKey="label" tick={{ fill: "#5C6C62", fontSize: 12 }} />
                    <YAxis tickFormatter={fmtShort} tick={{ fill: "#5C6C62", fontSize: 12 }} width={70} />
                    <Tooltip
                      formatter={(value) => formatIdr(value)}
                      contentStyle={{ background: "white", border: "1px solid #EAE6D7", borderRadius: 12, fontFamily: "inherit" }}
                    />
                    <Bar dataKey="revenue" fill="#52796F" radius={[6, 6, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {data?.months?.length > 0 && (
        <div className="mt-6 bl-card overflow-hidden" data-testid="reports-table">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead className="bg-[#F8F5EC] text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                <tr>
                  <th className="px-5 py-3">Month</th>
                  <th className="px-5 py-3 text-right">Revenue</th>
                  <th className="px-5 py-3 text-right">Items billed</th>
                </tr>
              </thead>
              <tbody>
                {data.months.slice().reverse().map(m => (
                  <tr key={m.month} className="border-t border-[#EAE6D7]" data-testid={`row-${m.month}`}>
                    <td className="px-5 py-3 text-sm text-[#2D3A33] font-medium">{monthLabel(m.month)}</td>
                    <td className="px-5 py-3 text-sm text-[#2D3A33] text-right tabular-nums">{formatIdr(m.revenue)}</td>
                    <td className="px-5 py-3 text-sm text-[#5C6C62] text-right tabular-nums">{m.items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, icon: Icon, testid }) {
  return (
    <div className="bl-card p-5" data-testid={testid}>
      <div className="label-eyebrow flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="font-display text-2xl text-[#2D3A33] mt-2 tabular-nums">{value}</div>
      <div className="text-xs text-[#5C6C62] mt-0.5">{sub}</div>
    </div>
  );
}
