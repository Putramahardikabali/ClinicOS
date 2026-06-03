import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABEL, canAccessNav, hasPermission, isAccountingUser } from "@/lib/auth";
import { useSettings, logoUrl } from "@/lib/settings";
import { useClinic, hasFeature } from "@/lib/clinic";
import { canAccessPathWhenLimited, canManageSubscription, isSubscriptionLimited } from "@/lib/subscriptionAccess";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import UsageWarningBanner from "@/components/UsageWarningBanner";
import BillingNotificationBanner from "@/components/BillingNotificationBanner";
import PlatformAnnouncementBanner from "@/components/PlatformAnnouncementBanner";
import InstallAppPrompt from "@/components/InstallAppPrompt";
import ExpiryGate from "@/components/ExpiryGate";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { HelpDrawer } from "@/pages/HelpPage";
import {
  LayoutDashboard, Users, Stethoscope, ScrollText, LogOut, Sparkles,
  Settings as SettingsIcon, Menu, X, User as UserIcon, ChevronRight, CreditCard, Lock,
  CalendarCheck, Pill, TrendingUp, Package, Boxes, Receipt, UserCog, LifeBuoy, ShoppingCart,
  Landmark,
  Gift,
  MessageSquare,
  ClipboardList,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view", roles: ["super_admin","doctor","therapist","nurse","fo","manager"] },
  { to: "/schedule", label: "Schedule", icon: CalendarCheck, permission: "schedule.view_own", roles: ["doctor","therapist","nurse"], shortLabel: "Schedule" },
  { to: "/bookings", label: "Bookings", icon: CalendarCheck, permission: "appointments.view", roles: ["super_admin","fo","manager"], feature: "online_booking" },
  { to: "/invoices", label: "Invoices", icon: Receipt, anyPermission: ["billing.view", "invoices.view"], roles: ["super_admin","fo","manager","accounting"], feature: "billing", shortLabel: "Invoices" },
  { to: "/daily-closing", label: "Daily Closing", icon: Landmark, anyPermission: ["closing.view", "closing.create", "accounting.view"], roles: ["super_admin","fo","manager","accounting"], feature: "products", shortLabel: "Closing" },
  { to: "/gift-cards", label: "Gift cards", icon: Gift, anyPermission: ["gift_cards.view", "accounting.view"], roles: ["super_admin","fo","manager","accounting"], feature: "products", shortLabel: "Gifts" },
  { to: "/patients", label: "Patients", icon: Users, anyPermission: ["patients.view", "patients.view_assigned"], roles: ["super_admin","fo","manager"] },
  { to: "/visits", label: "Visits", icon: Stethoscope, anyPermission: ["visits.view", "visits.view_own"], roles: ["super_admin","fo","manager"], feature: "emr" },
  { to: "/account", label: "Account", icon: UserIcon, roles: ["super_admin","manager","doctor","therapist","nurse","fo","accounting"], shortLabel: "Account" },
  { to: "/treatments", label: "Treatments", icon: Pill, permission: "treatments.manage", roles: ["super_admin","fo","manager"], shortLabel: "Treatments", feature: "treatments" },
  { to: "/packages", label: "Packages", icon: Package, permission: "packages_catalog.manage", roles: ["super_admin","fo","manager"], shortLabel: "Packages", feature: "packages" },
  { to: "/products", label: "Products", icon: Boxes, permission: "products.manage", roles: ["super_admin","fo","manager"], shortLabel: "Products", feature: "products" },
  { to: "/visit-settings", label: "Visit Settings", icon: ClipboardList, anyPermission: ["settings.manage", "consent.manage"], roles: ["super_admin", "manager"], shortLabel: "Visit", feature: "consent" },
  { to: "/messaging", label: "Messaging", icon: MessageSquare, anyPermission: ["messaging.view", "messaging.manage", "messaging.automation.view", "messaging.automation.manage"], roles: ["super_admin", "manager"], shortLabel: "Messaging", feature: "whatsapp_automation" },
  { to: "/finance-settings", label: "Finance Settings", icon: Landmark, anyPermission: ["commission.manage", "billing.manage", "settings.manage", "coupons.manage"], roles: ["super_admin", "manager"], shortLabel: "Finance" },
  { to: "/pos", label: "POS", icon: ShoppingCart, anyPermission: ["pos.view", "pos.create"], roles: ["super_admin","fo","manager","accounting"], shortLabel: "POS", feature: "products" },
  { to: "/reports", label: "Reports", icon: TrendingUp, anyPermission: ["reports.view", "billing.view", "accounting.view"], roles: ["super_admin","manager","accounting"], shortLabel: "Reports", feature: "reports" },
  { to: "/audit", label: "Audit Log", icon: ScrollText, permission: "audit.view", roles: ["super_admin","manager"], shortLabel: "Audit", feature: "audit_log" },
  { to: "/staff", label: "Staff", icon: UserCog, permission: "staff.view", roles: ["super_admin", "manager"], shortLabel: "Staff", anyPermission: ["staff.view", "roles.view"] },
  { to: "/admin", label: "Admin Settings", icon: SettingsIcon, permission: "settings.view", roles: ["super_admin", "manager"], shortLabel: "Admin" },
  { to: "/billing/plans", label: "Billing & Plan", icon: CreditCard, roles: ["super_admin", "manager"], shortLabel: "Billing" },
];

/** Grouped sidebar for Owner / Manager (no Schedule) */
const OPS_SIDEBAR = [
  { type: "link", paths: ["/"] },
  { type: "link", paths: ["/bookings"] },
  { type: "group", label: "Clinic", paths: ["/patients", "/visits", "/treatments", "/packages", "/products"] },
  { type: "group", label: "Retail", paths: ["/pos", "/gift-cards"] },
  { type: "group", label: "Finance", paths: ["/invoices", "/daily-closing", "/reports", "/finance-settings"] },
  { type: "group", label: "Clinical", paths: ["/visit-settings"] },
  { type: "group", label: "Communication", paths: ["/messaging"] },
  { type: "group", label: "Team", paths: ["/staff"] },
  { type: "group", label: "System", paths: ["/audit", "/admin", "/billing/plans", "/account"] },
];

const FO_SIDEBAR = [
  { type: "link", paths: ["/"] },
  { type: "link", paths: ["/bookings"] },
  { type: "group", label: "Front Desk", paths: ["/patients", "/visits", "/invoices", "/pos"] },
  { type: "group", label: "Daily Finance", paths: ["/daily-closing", "/gift-cards"] },
  { type: "group", label: "Catalog", paths: ["/treatments", "/packages", "/products"] },
  { type: "group", label: "System", paths: ["/account"] },
];

const isOpsSidebarRole = (role) => role === "super_admin" || role === "manager";

const ACCOUNTING_SIDEBAR = [
  { type: "link", paths: ["/reports"] },
  { type: "group", label: "Retail", paths: ["/pos", "/daily-closing", "/gift-cards"] },
  { type: "group", label: "Finance", paths: ["/invoices"] },
  { type: "link", paths: ["/account"] },
];

function navItemActive(item, pathname, userId) {
  if (item.to === "/") return pathname === "/";
  if (item.to === "/staff") return pathname.startsWith("/staff");
  if (item.to === "/account") return pathname === "/account" || pathname === "/profile" || (userId && pathname === `/staff/members/${userId}`);
  return pathname.startsWith(item.to);
}

// Bottom nav: only the 4 most relevant per role, plus "More" if extras exist
const BOTTOM_NAV_BY_ROLE = {
  super_admin: ["/", "/bookings", "/patients", "/visits"],
  doctor: ["/", "/schedule", "/visits", "/patients"],
  therapist: ["/", "/schedule", "/visits", "/patients"],
  nurse: ["/", "/schedule", "/visits", "/patients"],
  fo: ["/", "/bookings", "/invoices", "/patients"],
  manager: ["/", "/bookings", "/patients", "/invoices"],
  accounting: ["/reports", "/invoices", "/pos", "/daily-closing"],
};

export default function AppShell({ children }) {
  const { user, logout } = useAuth();
  const { branding } = useSettings();
  const { clinic } = useClinic();
  const loc = useLocation();
  const nav = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const isVisitWorkflowPage = /^\/visits\/[^/]+$/.test(loc.pathname);
  const appEnv = String(process.env.REACT_APP_APP_ENV || "").toLowerCase();
  const betaMode = String(process.env.REACT_APP_BETA_MODE || "").toLowerCase() === "true";
  const showBetaBadge = appEnv === "production_beta" || betaMode;
  const limited = isSubscriptionLimited(clinic);
  const visibleNav = NAV.filter(n => canAccessNav(user, n)).filter((n) => {
    if (!limited) return true;
    if (n.to === "/billing/plans" && !canManageSubscription(clinic, user)) return false;
    return canAccessPathWhenLimited(clinic, n.to, user);
  }).map(n => ({
    ...n,
    locked: n.feature && clinic && !hasFeature(clinic, n.feature),
  }));
  const navByPath = Object.fromEntries(visibleNav.map((n) => [n.to, n]));
  const useAccountingSidebar = isAccountingUser(user);
  const useFOSidebar = user?.role === "fo";
  const useGroupedSidebar = isOpsSidebarRole(user?.role) || useAccountingSidebar || useFOSidebar;
  const bottomKeys = BOTTOM_NAV_BY_ROLE[user?.role] || ["/", "/patients", "/visits"];
  const bottomItems = bottomKeys.map((k) => visibleNav.find((n) => n.to === k)).filter(Boolean);

  const renderNavLink = (n, onNavigate) => {
    const active = navItemActive(n, loc.pathname, user?.id);
    const Icon = n.icon;
    return (
      <Link
        key={n.to}
        to={n.to}
        onClick={onNavigate}
        className={`bl-sidebar-link ${active ? "active" : ""} ${n.locked ? "opacity-80" : ""}`}
        data-testid={`nav-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
        title={n.locked ? "Upgrade required — open to see upgrade options" : undefined}
      >
        <Icon className="w-4 h-4" strokeWidth={1.6} />
        <span className="flex-1">{n.label}</span>
        {n.locked && <Lock className="w-3 h-3 text-[#5C6C62]" />}
      </Link>
    );
  };

  const renderSidebarNav = (onNavigate) => {
    if (!useGroupedSidebar) {
      return visibleNav.map((n) => renderNavLink(n, onNavigate));
    }
    const layout = useAccountingSidebar
      ? ACCOUNTING_SIDEBAR
      : useFOSidebar
        ? FO_SIDEBAR
        : OPS_SIDEBAR;
    return layout.map((section, idx) => {
      const items = section.paths.map((p) => navByPath[p]).filter(Boolean);
      if (!items.length) return null;
      if (section.type === "link") {
        return items.map((n) => renderNavLink(n, onNavigate));
      }
      return (
        <div key={section.label || idx} className="pt-3 first:pt-0">
          <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#5C6C62]">
            {section.label}
          </div>
          <div className="space-y-1">
            {items.map((n) => renderNavLink(n, onNavigate))}
          </div>
        </div>
      );
    });
  };

  const Sidebar = ({ inDrawer = false }) => (
    <div className={`flex flex-col h-full ${inDrawer ? "" : "w-64 shrink-0 border-r border-[#EAE6D7]"}`} style={{ background: "#F3F1EB" }}>
      <div className="px-5 lg:px-6 py-5 lg:py-7 border-b border-[#EAE6D7] flex items-center justify-between">
        <button onClick={() => { nav(useAccountingSidebar ? "/reports" : "/"); setMobileOpen(false); }} className="flex items-center gap-2 text-left">
          {branding?.logo_path ? (
            <img src={logoUrl(branding.logo_path)} alt="logo" className="w-9 h-9 rounded-xl object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--bl-primary)" }}>
              <Sparkles className="w-5 h-5 text-white" strokeWidth={1.5} />
            </div>
          )}
          <div>
            <div className="font-display text-lg leading-tight text-[#2D3A33]">{branding?.clinic_name || clinic?.name || "ClinicOS"}</div>
            <div className="font-display text-sm -mt-0.5" style={{ color: "var(--bl-accent)" }}>{branding?.tagline || "Internal EMR"}</div>
          </div>
        </button>
        {inDrawer && (
          <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg hover:bg-[#ECE7D7]">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        {renderSidebarNav(() => setMobileOpen(false))}
      </nav>

      <div className="p-4 border-t border-[#EAE6D7]">
        <div className="bl-card p-4">
          <div className="label-eyebrow text-[10px]">Signed in</div>
          <div className="mt-1 text-sm font-medium text-[#2D3A33]" data-testid="current-user-name">{user?.name}</div>
          <div className="text-xs text-[#5C6C62]">{user?.role_name || ROLE_LABEL[user?.role]}</div>
          <button onClick={logout} className="mt-3 w-full bl-btn-ghost text-sm flex items-center justify-center gap-2" data-testid="logout-button">
            <LogOut className="w-4 h-4" strokeWidth={1.6} /> Logout
          </button>
          <button type="button" onClick={() => { setHelpOpen(true); setMobileOpen(false); }} className="mt-2 w-full bl-btn-ghost text-sm flex items-center justify-center gap-2" data-testid="help-support-btn">
            <LifeBuoy className="w-4 h-4" strokeWidth={1.6} /> Help & Support
          </button>
          <InstallAppPrompt compact />
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
        {showBetaBadge && (
          <div className="px-4 py-2 text-xs font-semibold text-amber-900 bg-amber-100 border-b border-amber-200 text-center tracking-wide">
            ClinicOS Beta Environment
          </div>
        )}
        <ImpersonationBanner />
        <BillingNotificationBanner />
        <UsageWarningBanner />
        <SubscriptionBanner />
        <PlatformAnnouncementBanner />
        {/* Mobile top bar — hidden on visit workflow for more vertical space */}
        <header
          className={`lg:hidden sticky top-0 z-30 bg-[#FDFBF7]/95 backdrop-blur border-b border-[#EAE6D7] px-4 py-3 flex items-center justify-between ${isVisitWorkflowPage ? "hidden" : ""}`}
          data-testid="mobile-app-header"
        >
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
            <div className="font-display text-base text-[#2D3A33]">{branding?.clinic_name || clinic?.name || "ClinicOS"}</div>
          </div>
          <button onClick={() => setProfileOpen(true)} className="p-1 -mr-1 rounded-full" data-testid="mobile-profile-button" aria-label="Profile">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold" style={{ background: "var(--bl-primary)" }}>
              {user?.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
          </button>
        </header>

        <div
          className={`flex-1 lg:pb-0 ${isVisitWorkflowPage ? "pb-[12.5rem]" : "pb-[calc(6rem+env(safe-area-inset-bottom,0px))]"}`}
          data-visit-workflow={isVisitWorkflowPage ? "true" : undefined}
        >
          {children}
        </div>

        {/* Mobile bottom navigation */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#EAE6D7] safe-area-pb" data-testid="bottom-nav">
          <div className="flex items-stretch justify-around">
            {bottomItems.map((n) => {
              const active = navItemActive(n, loc.pathname, user?.id);
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 active:bg-[#FBF8EF] transition relative"
                  data-testid={`bottom-nav-${n.label.toLowerCase().replace(/\s+/g,"-")}`}
                  title={n.locked ? "Upgrade required" : undefined}
                >
                  <Icon className="w-5 h-5" strokeWidth={active ? 2.2 : 1.6} style={{ color: active ? "var(--bl-primary)" : "#5C6C62" }} />
                  {n.locked && (
                    <Lock className="w-2.5 h-2.5 absolute top-2 right-[calc(50%-18px)] text-[#5C6C62]" />
                  )}
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
                  <div className="text-xs text-[#5C6C62]">{user?.email} · {user?.role_name || ROLE_LABEL[user?.role]}</div>
                </div>
              </div>

              <div className="mb-4">
                <InstallAppPrompt compact />
              </div>

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
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
