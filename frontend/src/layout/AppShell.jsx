import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import {
  LayoutDashboard, Users, Stethoscope, Receipt, ScrollText, LogOut, Sparkles,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/patients", label: "Patients", icon: Users, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/visits", label: "Visits", icon: Stethoscope, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/billing", label: "Pending Billing", icon: Receipt, roles: ["super_admin","fo","manager"] },
  { to: "/audit", label: "Audit Log", icon: ScrollText, roles: ["super_admin","manager"] },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();

  return (
    <div className="min-h-screen flex bg-[#FDFBF7]">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-[#EAE6D7] bg-[#F3F1EB] flex flex-col" data-testid="app-sidebar">
        <div className="px-6 py-7 border-b border-[#EAE6D7]">
          <button onClick={() => nav("/")} className="flex items-center gap-2 text-left">
            <div className="w-9 h-9 rounded-xl bg-[#8A9A86] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <div className="font-display text-lg leading-tight text-[#2D3A33]">Body Lab</div>
              <div className="font-display text-sm text-[#D4A373] -mt-0.5">Bali · EMR</div>
            </div>
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {NAV.filter(n => n.roles.includes(user?.role)).map((n) => {
            const active = n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`bl-sidebar-link ${active ? "active" : ""}`}
                data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g,"-")}`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.6} />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#EAE6D7]">
          <div className="bl-card p-4">
            <div className="label-eyebrow text-[10px]">Signed in</div>
            <div className="mt-1 text-sm font-medium text-[#2D3A33]" data-testid="current-user-name">{user?.name}</div>
            <div className="text-xs text-[#5C6C62]">{ROLE_LABEL[user?.role]}</div>
            <button onClick={logout} className="mt-3 w-full bl-btn-ghost text-sm flex items-center justify-center gap-2" data-testid="logout-button">
              <LogOut className="w-4 h-4" strokeWidth={1.6} /> Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
