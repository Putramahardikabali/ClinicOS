import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Link } from "react-router-dom";

export default function VisitsPage() {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("");
  useEffect(() => { api.get("/visits").then(r=>setItems(r.data)); }, []);
  const filtered = filter ? items.filter(v => v.status === filter) : items;
  return (
    <div className="p-8 md:p-10 max-w-7xl">
      <div className="label-eyebrow">All visits</div>
      <h1 className="font-display text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Visits</h1>

      <div className="mt-6 flex gap-2">
        {["", "in_progress", "submitted", "billed"].map((s) => (
          <button key={s||"all"} onClick={()=>setFilter(s)} className={`bl-chip ${filter===s ? "info" : ""}`} data-testid={`filter-${s||"all"}`}>
            {s === "" ? "All" : s.replace("_"," ")}
          </button>
        ))}
      </div>

      <div className="mt-6 bl-card overflow-hidden">
        <table className="w-full">
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
                <td className="px-5 py-4"><span className={`bl-chip ${v.status === "submitted" ? "warning" : v.status === "billed" ? "success" : "info"}`}>{v.status.replace("_"," ")}</span></td>
                <td className="px-5 py-4 text-sm text-[#5C6C62]">{new Date(v.visit_date || v.created_at).toLocaleDateString()}</td>
                <td className="px-5 py-4 text-right"><Link to={`/visits/${v.id}`} className="text-sm text-[#8A9A86] hover:text-[#748470]">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
