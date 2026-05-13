import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { useSettings, logoUrl } from "@/lib/settings";
import { useClinic, hasFeature } from "@/lib/clinic";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import ExpiryGate from "@/components/ExpiryGate";
import {
  LayoutDashboard, Users, Stethoscope, ScrollText, LogOut, Sparkles,
  Settings as SettingsIcon, Menu, X, User as UserIcon, ChevronRight, CreditCard, Lock,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/patients", label: "Patients", icon: Users, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/visits", label: "Visits", icon: Stethoscope, roles: ["super_admin","doctor","therapist","fo","manager"] },
  { to: "/audit", label: "Audit Log", icon: ScrollText, roles: ["super_admin","manager"], shortLabel: "Audit", feature: "audit_log" },
  { to: "/admin", label: "Admin Settings", icon: SettingsIcon, roles: ["super_admin"], shortLabel: "Admin" },
  { to: "/billing/plans", label: "Billing & Plan", icon: CreditCard, roles: ["super_admin"], shortLabel: "Billing" },
];

// Bottom nav: only the 4 most relevant per role, plus "More" if extras exist
const BOTTOM_NAV_BY_ROLE = {
  super_admin: ["/", "/patients", "/visits", "/admin"],
  doctor: ["/", "/patients", "/visits"],
  therapist: ["/", "/patients", "/visits"],
  fo: ["/", "/patients", "/visits"],
  manager: ["/", "/patients", "/visits", "/audit"],
};

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const { branding } = useSettings();
  const { clinic } = useClinic();
  const loc = useLocation();
  const nav = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const visibleNav = NAV.filter(n => n.roles.includes(user?.role)).map(n => ({
    ...n,
    locked: n.feature && clinic && !hasFeature(clinic, n.feature),
  }));
  const bottomKeys = BOTTOM_NAV_BY_ROLE[user?.role] || ["/", "/patients", "/visits"];
  const bottomItems = bottomKeys.map(k => visibleNav.find(n => n.to === k)).filter(Boolean);

  const Sidebar = ({ inDrawer = false }) => (
    <div className={`flex flex-col h-full ${inDrawer ? "" : "w-64 shrink-0 border-r border-[#EAE6D7]"}`} style={{ background: "#F3F1EB" }}>
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
            <div className="font-display text-lg leading-tight text-[#2D3A33]">{branding?.clinic_name || "Body Lab Bali"}</div>
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
        {visibleNav.map((n) => {
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
              <span className="flex-1">{n.label}</span>
              {n.locked && <Lock className="w-3 h-3 text-[#5C6C62]" />}
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
      <ExpiryGate />
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex" data-testid="app-sidebar">
        <Sidebar />
      </aside>

      {/* Mobile drawer (overflow nav) */}
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
        <SubscriptionBanner />
        {/* Mobile top bar — slim, app-like */}
        <header className="lg:hidden sticky top-0 z-30 bg-[#FDFBF7]/95 backdrop-blur border-b border-[#EAE6D7] px-4 py-3 flex items-center justify-between">
          <button onClick={() => setMobileOpen(true)} className="p-2 -ml-2 rounded-lg active:bg-[#F3F1EB]" data-testid="mobile-menu-button" aria-label="Menu">
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
          <button onClick={() => setProfileOpen(true)} className="p-1 -mr-1 rounded-full" data-testid="mobile-profile-button" aria-label="Profile">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ background: "var(--bl-primary)" }}>
              {user?.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
          </button>
        </header>

        <div className="flex-1 pb-24 lg:pb-0">{children}</div>

        {/* Mobile bottom navigation */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#EAE6D7] safe-area-pb" data-testid="bottom-nav">
          <div className="flex items-stretch justify-around">
            {bottomItems.map((n) => {
              const active = n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 active:bg-[#FBF8EF] transition"
                  data-testid={`bottom-nav-${n.label.toLowerCase().replace(/\s+/g,"-")}`}
                >
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.2 : 1.6} style={{ color: active ? "var(--bl-primary)" : "#5C6C62" }} />
                  <span className="text-[10px] font-medium" style={{ color: active ? "var(--bl-text)" : "#5C6C62" }}>{n.shortLabel || n.label}</span>
                </Link>
              );
            })}
            <button
              onClick={() => setProfileOpen(true)}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 active:bg-[#FBF8EF] transition"
              data-testid="bottom-nav-more"
            >
              <UserIcon className="w-5 h-5 text-[#5C6C62]" strokeWidth={1.6} />
              <span className="text-[10px] font-medium text-[#5C6C62]">More</span>
            </button>
          </div>
        </nav>

        {/* Mobile profile sheet */}
        {profileOpen && (
          <>
            <div className="bl-mobile-overlay lg:hidden" onClick={() => setProfileOpen(false)} />
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl p-5 pb-8 shadow-2xl animate-slide-up" data-testid="profile-sheet">
              <div className="w-12 h-1.5 bg-[#EAE6D7] rounded-full mx-auto mb-5" />
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-semibold" style={{ background: "var(--bl-primary)" }}>
                  {user?.name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <div>
                  <div className="font-display text-lg text-[#2D3A33]">{user?.name}</div>
                  <div className="text-xs text-[#5C6C62]">{user?.email} · {ROLE_LABEL[user?.role]}</div>
                </div>
              </div>

              {/* Overflow nav (items not in bottom bar) */}
              {visibleNav.filter(n => !bottomItems.find(b => b.to === n.to)).map(n => {
                const Icon = n.icon;
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center justify-between py-3 border-b border-[#EAE6D7] last:border-b-0"
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-[#5C6C62]" strokeWidth={1.6} />
                      <span className="text-[#2D3A33]">{n.label}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-[#5C6C62]" />
                  </Link>
                );
              })}

              <button
                onClick={async () => { setProfileOpen(false); await logout(); }}
                className="mt-5 w-full py-3 rounded-xl flex items-center justify-center gap-2 font-medium"
                style={{ background: "#FBE7DF", color: "#B14A2C" }}
                data-testid="mobile-logout"
              >
                <LogOut className="w-4 h-4" /> Logout
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
