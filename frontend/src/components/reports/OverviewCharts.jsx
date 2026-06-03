import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { formatIdr } from "@/lib/clinic";

const COLORS = ["#52796F", "#84A98C", "#CAD2C5", "#354F52", "#2F3E46", "#A8C5B8", "#6B9080", "#B7C4A8"];

const fmtShort = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(v);
};

function ChartCard({ title, subtitle, children, empty }) {
  return (
    <div className="bl-card p-4">
      <h3 className="font-display text-base text-[#2D3A33]">{title}</h3>
      {subtitle && <p className="text-xs text-[#5C6C62] mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {empty ? (
        <p className="text-sm text-[#5C6C62] py-8 text-center">No data for this range.</p>
      ) : (
        <div style={{ width: "100%", height: 260 }}>{children}</div>
      )}
    </div>
  );
}

function moneyTip(value) {
  return formatIdr(value);
}

export default function OverviewCharts({ charts }) {
  const c = charts || {};
  const revenueTrend = (c.revenue_trend || []).map((r) => ({ ...r, label: (r.date || "").slice(5) }));
  const paymentMethods = (c.revenue_by_payment_method || []).map((r) => ({
    name: String(r.method || "other").replace(/_/g, " "),
    value: r.revenue_idr,
  }));
  const topTreatments = (c.top_treatments || []).slice(0, 8).map((r) => ({
    name: r.name?.length > 22 ? `${r.name.slice(0, 20)}…` : r.name,
    revenue: r.revenue_idr,
  }));
  const packageUsage = (c.package_usage || []).slice(0, 8).map((r) => ({
    name: r.treatment?.length > 22 ? `${r.treatment.slice(0, 20)}…` : r.treatment,
    count: r.count,
  }));
  const apptStatus = (c.appointment_status || []).map((r) => ({
    name: `Appt: ${String(r.status || "").replace(/_/g, " ")}`,
    count: r.count,
    type: "appointment",
  }));
  const visitStatus = (c.visit_status || []).map((r) => ({
    name: `Visit: ${String(r.status || "").replace(/_/g, " ")}`,
    count: r.count,
    type: "visit",
  }));
  const statusCombined = [...apptStatus, ...visitStatus];
  const commissionStatus = (c.commission_status || []).map((r) => ({
    name: String(r.status || "").replace(/_/g, " "),
    value: r.amount_idr,
  }));

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Revenue trend" subtitle="Paid invoices only — cash revenue in selected range" empty={!revenueTrend.length}>
        <ResponsiveContainer>
          <LineChart data={revenueTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" />
            <XAxis dataKey="label" tick={{ fill: "#5C6C62", fontSize: 11 }} />
            <YAxis tickFormatter={fmtShort} tick={{ fill: "#5C6C62", fontSize: 11 }} width={52} />
            <Tooltip formatter={moneyTip} labelFormatter={(l, p) => p?.[0]?.payload?.date || l} />
            <Line type="monotone" dataKey="revenue_idr" stroke="#52796F" strokeWidth={2} dot={{ r: 3, fill: "#52796F" }} name="Revenue" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Appointment & visit status" subtitle="Counts in selected date range" empty={!statusCombined.length}>
        <ResponsiveContainer>
          <BarChart data={statusCombined} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" horizontal={false} />
            <XAxis type="number" tick={{ fill: "#5C6C62", fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#5C6C62", fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#52796F" radius={[0, 4, 4, 0]} name="Count" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Revenue by payment method" subtitle="Paid invoice totals" empty={!paymentMethods.length}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={paymentMethods} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
              {paymentMethods.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={moneyTip} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top treatments" subtitle="Cash revenue from paid invoice lines (excludes package-paid)" empty={!topTreatments.length}>
        <ResponsiveContainer>
          <BarChart data={topTreatments} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" />
            <XAxis dataKey="name" tick={{ fill: "#5C6C62", fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
            <YAxis tickFormatter={fmtShort} tick={{ fill: "#5C6C62", fontSize: 11 }} width={52} />
            <Tooltip formatter={moneyTip} />
            <Bar dataKey="revenue" fill="#84A98C" radius={[4, 4, 0, 0]} name="Revenue" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Package usage" subtitle="Sessions/components used — not new cash revenue" empty={!packageUsage.length}>
        <ResponsiveContainer>
          <BarChart data={packageUsage} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EAE6D7" />
            <XAxis dataKey="name" tick={{ fill: "#5C6C62", fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
            <YAxis tick={{ fill: "#5C6C62", fontSize: 11 }} width={36} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#354F52" radius={[4, 4, 0, 0]} name="Used" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Commission status" subtitle="From existing commission records only" empty={!commissionStatus.length}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={commissionStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88} label={({ name }) => name}>
              {commissionStatus.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={moneyTip} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
