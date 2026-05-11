import { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { Link } from "react-router-dom";
import { Users, Stethoscope, Activity, Calendar, CheckCircle2 } from "lucide-react";

const Stat = ({ icon: Icon, label, value, accent }) => (
  <div className="bl-card p-6" data-testid={`stat-${label.toLowerCase().replace(/\s+/g,"-")}`}>
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent}`}>
        <Icon className="w-5 h-5" strokeWidth={1.6} />
      </div>
      <div className="label-eyebrow">{label}</div>
    </div>
    <div className="mt-4 font-display text-4xl text-[#2D3A33]">{value}</div>
  </div>
);

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({});
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    api.get("/stats").then(r => setStats(r.data)).catch(()=>{});
    api.get("/visits").then(r => setRecent(r.data.slice(0,8))).catch(()=>{});
  }, []);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="label-eyebrow">{ROLE_LABEL[user?.role]} dashboard</div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl tracking-tight font-light mt-2 text-[#2D3A33]">
            Hello, <span style={{ color: "var(--bl-primary)" }}>{user?.name?.split(" ")[0]}</span>
          </h1>
          <p className="mt-2 text-[#5C6C62]">
            Today is {new Date().toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/patients" className="bl-btn-ghost" data-testid="dash-quick-patients">View patients</Link>
          {(user?.role === "fo" || user?.role === "super_admin") && (
            <Link to="/patients" className="bl-btn-primary" data-testid="dash-quick-new-patient">+ New patient</Link>
          )}
        </div>
      </div>

      <div className="mt-10 grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        <Stat icon={Users} label="Total patients" value={stats.total_patients ?? "—"} accent="bg-[#EDF3EF] text-[#52796F]" />
        <Stat icon={Calendar} label="Visits today" value={stats.visits_today ?? "—"} accent="bg-[#FBF3DB] text-[#8A6D1F]" />
        <Stat icon={Stethoscope} label="In progress" value={stats.in_progress ?? "—"} accent="bg-[#E5EEF5] text-[#2C5A77]" />
        <Stat icon={CheckCircle2} label="Completed" value={stats.completed ?? "—"} accent="bg-[#EDF3EF] text-[#52796F]" />
        <Stat icon={Activity} label="Total visits" value={stats.total_visits ?? "—"} accent="bg-[#F3F1EB] text-[#5C6C62]" />
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl sm:text-2xl text-[#2D3A33]">Recent visits</h2>
          <Link to="/visits" className="text-sm" style={{ color: "var(--bl-primary)" }}>See all →</Link>
        </div>
        <div className="bl-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-[#F8F5EC]">
                <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
                  <th className="px-5 py-3">Patient</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10 text-[#5C6C62]">No visits yet</td></tr>
                )}
                {recent.map((v) => (
                  <tr key={v.id} className="border-t border-[#EAE6D7]">
                    <td className="px-5 py-4 font-medium text-[#2D3A33]">{v.patient_name}</td>
                    <td className="px-5 py-4 capitalize text-[#5C6C62]">{v.visit_type}</td>
                    <td className="px-5 py-4">
                      <span className={`bl-chip ${v.status === "completed" ? "success" : "info"}`}>
                        {v.status.replace("_"," ")}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#5C6C62] text-sm">
                      {new Date(v.visit_date || v.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Link to={`/visits/${v.id}`} className="text-sm" style={{ color: "var(--bl-primary)" }}>Open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
