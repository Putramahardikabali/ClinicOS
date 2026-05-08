import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { useSettings, logoUrl } from "@/lib/settings";
import {
  LayoutDashboard, Users, Stethoscope, Receipt, ScrollText, LogOut, Sparkles,
  Settings as SettingsIcon, Menu, X,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/patients", label: "Patients", icon: Users, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/visits", label: "Visits", icon: Stethoscope, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/billing", label: "Pending Billing", icon: Receipt, roles: ["super_admin","fo","manager"] },
  { to: "/audit", label: "Audit Log", icon: ScrollText, roles: ["super_admin","manager"] },
  { to: "/admin", label: "Admin Settings", icon: SettingsIcon, roles: ["super_admin"] },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const { branding } = useSettings();
  const loc = useLocation();
  const nav = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const Sidebar = ({ inDrawer = false }) => (
    <div className={`flex flex-col h-full ${inDrawer ? "" : "w-64 shrink-0 border-r border-[#EAE6D7] bg-[#F3F1EB]"}`} style={inDrawer ? { background: "#F3F1EB" } : {}}>
      <div className="px-5 lg:px-6 py-5 lg:py-7 border-b border-[#EAE6D7] flex items-center justify-between">
        <button onClick={() => { nav("/"); setMobileOpen(false); }} className="flex items-center gap-2 text-left">
          {branding?.logo_path ? (
            <img src={logoUrl(branding.logo_path)} alt="logo" className="w-9 h-9 rounded-xl object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
              <Sparkles className="w-5 h-5 text-white" strokeWidth={1.5} />
            </div>
          )}
          <div>
            <div className="font-display text-lg leading-tight text-[#2D3A33]">{branding?.clinic_name?.split(" ")[0] || "Body"} {branding?.clinic_name?.split(" ").slice(1).join(" ") || "Lab"}</div>
            <div className="font-display text-sm -mt-0.5" style={{ color: "var(--bl-accent)" }}>{branding?.tagline?.includes("·") ? branding.tagline.split("·")[1].trim() : "EMR"}</div>
          </div>
        </button>
        {inDrawer && (
          <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg hover:bg-[#ECE7D7]">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        {NAV.filter(n => n.roles.includes(user?.role)).map((n) => {
          const active = n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to);
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={() => setMobileOpen(false)}
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
    </div>
  );

  return (
    <div className="min-h-screen flex" style={{ background: "var(--bl-background)" }}>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex" data-testid="app-sidebar">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div className="bl-mobile-overlay lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed top-0 left-0 bottom-0 w-72 z-50 lg:hidden">
            <Sidebar inDrawer />
          </aside>
        </>
      )}

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 bg-[#FDFBF7]/95 backdrop-blur border-b border-[#EAE6D7] px-4 py-3 flex items-center justify-between">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-lg hover:bg-[#F3F1EB]" data-testid="mobile-menu-button">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            {branding?.logo_path ? (
              <img src={logoUrl(branding.logo_path)} alt="logo" className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
                <Sparkles className="w-4 h-4 text-white" />
              </div>
            )}
            <div className="font-display text-base text-[#2D3A33]">{branding?.clinic_name || "Body Lab Bali"}</div>
          </div>
          <div className="w-9" />
        </header>

        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}
