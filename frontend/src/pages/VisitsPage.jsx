import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Link } from "react-router-dom";

export default function VisitsPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("");
  useEffect(() => { api.get("/visits").then(r=>setItems(r.data)); }, []);
  const filtered = filter ? items.filter(v => v.status === filter) : items;
  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <div className="label-eyebrow">All visits</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Visits</h1>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {["", "in_progress", "completed"].map((s) => (
          <button key={s||"all"} onClick={()=>setFilter(s)} className={`bl-chip whitespace-nowrap ${filter===s ? "info" : ""}`} data-testid={`filter-${s||"all"}`}>
            {s === "" ? "All" : s.replace("_"," ")}
          </button>
        ))}
      </div>

      {/* Mobile: card list */}
      <div className="mt-6 space-y-3 lg:hidden">
        {filtered.length === 0 && <div className="bl-card p-8 text-center text-[#5C6C62]">No visits</div>}
        {filtered.map(v => (
          <Link key={v.id} to={`/visits/${v.id}`} className="bl-card p-4 flex items-center gap-3 active:bg-[#FBF8EF]">
            <div className="w-11 h-11 rounded-2xl bg-[#F3F1EB] flex flex-col items-center justify-center shrink-0">
              <span className="font-display text-base text-[#2D3A33] leading-none">{new Date(v.visit_date || v.created_at).getDate()}</span>
              <span className="text-[9px] uppercase tracking-widest text-[#5C6C62] mt-0.5">{new Date(v.visit_date || v.created_at).toLocaleString("en-US",{month:"short"})}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[#2D3A33] truncate">{v.patient_name}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-[#5C6C62] capitalize">{v.visit_type}</span>
                <span className={`bl-chip text-[10px] py-0.5 px-1.5 ${v.status === "completed" ? "success" : "info"}`}>{v.status.replace("_"," ")}</span>
              </div>
            </div>
            <div className="text-[#5C6C62]">›</div>
          </Link>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="mt-6 bl-card overflow-hidden hidden lg:block">
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
            {filtered.length===0 && <tr><td colSpan={5} className="text-center py-10 text-[#5C6C62]">No visits</td></tr>}
            {filtered.map(v => (
              <tr key={v.id} className="border-t border-[#EAE6D7] hover:bg-[#FBF8EF]">
                <td className="px-5 py-4 font-medium">{v.patient_name}</td>
                <td className="px-5 py-4 capitalize text-[#5C6C62]">{v.visit_type}</td>
                <td className="px-5 py-4"><span className={`bl-chip ${v.status === "completed" ? "success" : "info"}`}>{v.status.replace("_"," ")}</span></td>
                <td className="px-5 py-4 text-sm text-[#5C6C62]">{new Date(v.visit_date || v.created_at).toLocaleDateString()}</td>
                <td className="px-5 py-4 text-right"><Link to={`/visits/${v.id}`} className="text-sm text-[#8A9A86] hover:text-[#748470]">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
