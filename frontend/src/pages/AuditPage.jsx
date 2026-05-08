import { useEffect, useState } from "react";
import api from "@/lib/api";

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { api.get("/audit-logs").then(r=>setLogs(r.data)); }, []);
  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <div className="label-eyebrow">System</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Audit log</h1>
      <p className="mt-2 text-[#5C6C62]">Chronological list of all actions taken in the system.</p>

      <div className="mt-8 bl-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="bg-[#F8F5EC]">
            <tr className="text-left text-xs uppercase tracking-widest text-[#5C6C62]">
              <th className="px-5 py-3">Time</th>
              <th className="px-5 py-3">User</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Action</th>
              <th className="px-5 py-3">Entity</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-[#5C6C62]">No activity yet</td></tr>}
            {logs.map(l => (
              <tr key={l.id} className="border-t border-[#EAE6D7]">
                <td className="px-5 py-3 text-sm text-[#5C6C62]">{new Date(l.created_at).toLocaleString()}</td>
                <td className="px-5 py-3 font-medium">{l.user_email}</td>
                <td className="px-5 py-3 text-[#5C6C62] capitalize">{l.user_role.replace("_"," ")}</td>
                <td className="px-5 py-3"><span className="bl-chip">{l.action}</span></td>
                <td className="px-5 py-3 text-[#5C6C62]">{l.entity}{l.entity_id ? ` · ${l.entity_id.slice(0,8)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
