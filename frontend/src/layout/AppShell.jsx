import { useState, useEffect, useCallback } from "react";
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
import FrontDeskReminderLayer from "@/components/frontdesk/FrontDeskReminderLayer";
import { FrontDeskReminderProvider } from "@/lib/frontDeskReminderContext";
import { RealtimeEventsProvider } from "@/lib/realtimeEventsContext";
import { useAppointmentWorkspace } from "@/lib/appointmentWorkspaceContext";
import { HelpDrawer } from "@/pages/HelpPage";
import {
  LayoutDashboard, Users, Stethoscope, ScrollText, LogOut, Sparkles,
  Settings as SettingsIcon, Menu, X, User as UserIcon, ChevronRight, ChevronDown, CreditCard, Lock,
  CalendarCheck, Pill, TrendingUp, BarChart3, Package, Boxes, Receipt, UserCog, LifeBuoy, ShoppingCart,
  Hourglass,
  Landmark,
  Gift,
  MessageSquare,
  ClipboardList,
  Tag,
  Award,
  Shield,
} from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view", roles: ["super_admin","doctor","therapist","nurse","fo","manager"] },
  { to: "/schedule", label: "Schedule", icon: CalendarCheck, permission: "schedule.view_own", roles: ["doctor","therapist","nurse"], shortLabel: "Schedule" },
  { to: "/bookings", label: "Appointments", foShortLabel: "Appts", icon: CalendarCheck, permission: "appointments.view", roles: ["super_admin","fo","manager"], feature: "online_booking" },
  { to: "/waiting-list", label: "Waiting List", foShortLabel: "Waitlist", shortLabel: "Waitlist", icon: Hourglass, permission: "waiting_list.view", roles: ["super_admin","fo","manager"], feature: "online_booking" },
  { to: "/invoices", label: "Invoices", icon: Receipt, anyPermission: ["billing.view", "invoices.view"], roles: ["super_admin","fo","manager","accounting"], feature: "billing", shortLabel: "Invoices" },
  { to: "/daily-closing", label: "Daily Closing", icon: Landmark, anyPermission: ["closing.view", "closing.create", "accounting.view"], roles: ["super_admin","fo","manager","accounting"], feature: "products", shortLabel: "Closing" },
  { to: "/gift-cards", label: "Gift cards", icon: Gift, anyPermission: ["gift_cards.view", "accounting.view"], roles: ["super_admin","fo","manager","accounting"], feature: "products", shortLabel: "Gifts" },
  { to: "/patients", label: "Patients", icon: Users, anyPermission: ["patients.view", "patients.view_assigned"], roles: ["super_admin","fo","manager"] },
  { to: "/visits", label: "Treatment sessions", opsLabel: "Treatment Sessions", foLabel: "Session records", foShortLabel: "Sessions", shortLabel: "Sessions", icon: Stethoscope, anyPermission: ["visits.view", "visits.view_own"], roles: ["super_admin","fo","manager"], feature: "emr" },
  { to: "/account", label: "Account", icon: UserIcon, roles: ["super_admin","manager","doctor","therapist","nurse","fo","accounting"], shortLabel: "Account" },
  { to: "/treatments", label: "Treatments", icon: Pill, permission: "treatments.manage", roles: ["super_admin","fo","manager"], shortLabel: "Treatments", feature: "treatments" },
  { to: "/packages", label: "Packages", icon: Package, permission: "packages_catalog.manage", roles: ["super_admin","fo","manager"], shortLabel: "Packages", feature: "packages" },
  { to: "/products", label: "Products", icon: Boxes, permission: "products.manage", roles: ["super_admin","fo","manager"], shortLabel: "Products", feature: "products" },
  { to: "/visit-settings", label: "Session settings", icon: ClipboardList, anyPermission: ["settings.manage", "consent.manage"], roles: ["super_admin", "manager"], shortLabel: "Sessions", feature: "consent" },
  { to: "/messaging", label: "Messaging", icon: MessageSquare, anyPermission: ["messaging.view", "messaging.manage", "messaging.automation.view", "messaging.automation.manage"], roles: ["super_admin", "manager"], shortLabel: "Messaging", feature: "whatsapp_automation" },
  { to: "/campaigns", label: "Campaigns", icon: Tag, anyPermission: ["campaigns.manage", "campaigns.view", "coupons.manage"], roles: ["super_admin", "manager"], shortLabel: "Campaigns" },
  { to: "/loyalty", label: "Loyalty", icon: Award, anyPermission: ["loyalty.manage", "loyalty.view"], roles: ["super_admin", "manager"], shortLabel: "Loyalty" },
  { to: "/patient-labels", label: "Patient Labels", icon: Shield, anyPermission: ["patient_labels.manage", "patient_labels.view"], roles: ["super_admin", "manager"], shortLabel: "Labels" },
  { to: "/pos", label: "POS", icon: ShoppingCart, anyPermission: ["pos.view", "pos.create"], roles: ["super_admin","fo","manager","accounting"], shortLabel: "POS", feature: "products" },
  { to: "/reports", label: "Reports", icon: TrendingUp, anyPermission: ["reports.view", "billing.view", "accounting.view"], roles: ["super_admin","manager","accounting"], shortLabel: "Reports", feature: "reports" },
  { to: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics.view", roles: ["super_admin", "manager"], shortLabel: "Analytics", feature: "reports" },
  { to: "/audit", label: "Audit Log", icon: ScrollText, permission: "audit.view", roles: ["super_admin","manager"], shortLabel: "Audit", feature: "audit_log" },
  { to: "/staff", label: "Staff", icon: UserCog, permission: "staff.view", roles: ["super_admin", "manager"], shortLabel: "Staff", anyPermission: ["staff.view", "roles.view"] },
  { to: "/admin", label: "General Settings", icon: SettingsIcon, permission: "settings.view", roles: ["super_admin", "manager"], shortLabel: "General", anyPermission: ["settings.view", "commission.manage", "billing.manage", "settings.manage"] },
  { to: "/billing/plans", label: "Billing & Plan", icon: CreditCard, roles: ["super_admin", "manager"], shortLabel: "Billing" },
];

/** Grouped sidebar for Owner / Manager (no Schedule) */
const OPS_SETTINGS_PATHS = [
  "/admin",
  "/loyalty",
  "/patient-labels",
  "/messaging",
  "/visit-settings",
  "/billing/plans",
  "/account",
  "/audit",
];

const OPS_SETTINGS_LABELS = {
  "/admin": "General",
  "/loyalty": "Loyalty",
  "/patient-labels": "Patient Labels",
  "/messaging": "Messaging",
  "/visit-settings": "Session",
  "/billing/plans": "Billing & Plan",
  "/account": "Account",
  "/audit": "Audit Log",
};

const SETTINGS_EXPANDED_STORAGE_KEY = "clinicos.sidebar.settingsExpanded";

const OPS_SIDEBAR = [
  { type: "link", paths: ["/"] },
  { type: "group", label: "Clinic Operations", paths: ["/bookings", "/waiting-list", "/patients", "/visits"] },
  { type: "group", label: "Catalog", paths: ["/treatments", "/packages", "/products", "/gift-cards"] },
  { type: "link", paths: ["/pos"] },
  { type: "group", label: "Finance & Reports", paths: ["/invoices", "/daily-closing", "/analytics", "/reports"] },
  { type: "link", paths: ["/campaigns"] },
  { type: "link", paths: ["/staff"] },
  { type: "settings", paths: OPS_SETTINGS_PATHS },
];

const FO_SIDEBAR = [
  { type: "link", paths: ["/"] },
  { type: "link", paths: ["/bookings"] },
  { type: "link", paths: ["/waiting-list"] },
  { type: "group", label: "Front Desk", paths: ["/patients", "/visits", "/invoices", "/pos"] },
  { type: "group", label: "Daily Finance", paths: ["/daily-closing", "/gift-cards"] },
  { type: "group", label: "Catalog", paths: ["/treatments", "/packages", "/products"] },
  { type: "group", label: "System", paths: ["/account"] },
];

const isOpsSidebarRole = (role) => role === "super_admin" || role === "manager";

function navDisplayLabel(n, role, { short = false, ops = false } = {}) {
  if (ops && n.opsLabel) return n.opsLabel;
  if (role === "fo") {
    if (short && n.foShortLabel) return n.foShortLabel;
    if (n.foLabel) return n.foLabel;
  }
  return short ? (n.shortLabel || n.label) : n.label;
}

function isOpsSettingsPath(pathname) {
  return OPS_SETTINGS_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}

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
  const [settingsExpanded, setSettingsExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_EXPANDED_STORAGE_KEY);
      if (stored !== null) return stored === "true";
    } catch { /* ignore */ }
    return false;
  });

  const useOpsSidebar = isOpsSidebarRole(user?.role);

  useEffect(() => {
    if (useOpsSidebar && isOpsSettingsPath(loc.pathname)) {
      setSettingsExpanded(true);
    }
  }, [loc.pathname, useOpsSidebar]);

  const toggleSettingsExpanded = useCallback(() => {
    setSettingsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SETTINGS_EXPANDED_STORAGE_KEY, String(next));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

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
  const { isAppointmentWorkspace, isNavigationDrawerOpen, closeNavigationDrawer } = useAppointmentWorkspace();
  const appointmentWorkspaceActive = isAppointmentWorkspace;
  const bottomKeys = BOTTOM_NAV_BY_ROLE[user?.role] || ["/", "/patients", "/visits"];
  const bottomItems = bottomKeys.map((k) => visibleNav.find((n) => n.to === k)).filter(Boolean);

  const renderNavLink = (n, onNavigate, { indent = false, labelOverride } = {}) => {
    const active = navItemActive(n, loc.pathname, user?.id);
    const Icon = n.icon;
    const label = labelOverride || navDisplayLabel(n, user?.role, { ops: useOpsSidebar });
    return (
      <Link
        key={n.to}
        to={n.to}
        onClick={onNavigate}
        className={`bl-sidebar-link ${active ? "active" : ""} ${n.locked ? "opacity-80" : ""} ${indent ? "ml-2 pl-8 !py-2 text-[13px]" : ""}`}
        data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
        title={n.locked ? "Upgrade required — open to see upgrade options" : undefined}
      >
        {!indent && <Icon className="w-4 h-4" strokeWidth={1.6} />}
        <span className="flex-1">{label}</span>
        {n.locked && <Lock className="w-3 h-3 text-[var(--bl-sidebar-muted-text)]" />}
      </Link>
    );
  };

  const renderSettingsSection = (section, onNavigate) => {
    const items = section.paths.map((p) => navByPath[p]).filter(Boolean);
    if (!items.length) return null;
    const anyChildActive = items.some((n) => navItemActive(n, loc.pathname, user?.id));

    return (
      <div key="settings" className="pt-3">
        <button
          type="button"
          onClick={toggleSettingsExpanded}
          className={`bl-sidebar-link w-full ${anyChildActive ? "active" : ""}`}
          data-testid="nav-settings-toggle"
          aria-expanded={settingsExpanded}
        >
          <SettingsIcon className="w-4 h-4" strokeWidth={1.6} />
          <span className="flex-1 text-left">Settings</span>
          <ChevronDown
            className={`w-4 h-4 text-[var(--bl-sidebar-muted-text)] transition-transform duration-200 ${settingsExpanded ? "rotate-180" : ""}`}
          />
        </button>
        {settingsExpanded && (
          <div className="mt-0.5 space-y-0.5 border-l bl-sidebar-settings-children ml-5">
            {items.map((n) => renderNavLink(n, onNavigate, {
              indent: true,
              labelOverride: OPS_SETTINGS_LABELS[n.to] || navDisplayLabel(n, user?.role, { ops: true }),
            }))}
          </div>
        )}
      </div>
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
      if (section.type === "settings") {
        return renderSettingsSection(section, onNavigate);
      }
      if (section.type === "link") {
        return items.map((n) => renderNavLink(n, onNavigate));
      }
      return (
        <div key={section.label || idx} className="pt-3 first:pt-0">
          <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest bl-sidebar-section-label">
            {section.label}
          </div>
          <div className="space-y-1">
            {items.map((n) => renderNavLink(n, onNavigate))}
          </div>
        </div>
      );
    });
  };

  const Sidebar = ({ inDrawer = false, onClose }) => {
    const closeNav = () => {
      onClose?.();
      setMobileOpen(false);
    };

    return (
    <div className={`flex flex-col h-full bl-sidebar-shell ${inDrawer ? "" : "w-64 shrink-0 border-r"}`}>
      <div className="px-5 lg:px-6 py-5 lg:py-7 border-b bl-sidebar-header flex items-center justify-between">
        <button onClick={() => { nav(useAccountingSidebar ? "/reports" : "/"); closeNav(); }} className="flex items-center gap-2 text-left">
          {branding?.logo_path ? (
            <img src={logoUrl(branding.logo_path)} alt="logo" className="w-9 h-9 rounded-xl object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--bl-primary)", color: "var(--bl-primary-contrast)" }}>
              <Sparkles className="w-5 h-5" strokeWidth={1.5} />
            </div>
          )}
          <div>
            <div className="font-display text-lg leading-tight text-[var(--bl-sidebar-text)]">{branding?.clinic_name || clinic?.name || "ClinicOS"}</div>
            <div className="font-display text-sm -mt-0.5" style={{ color: "var(--bl-accent)" }}>{branding?.tagline || "Clinic management"}</div>
          </div>
        </button>
        {inDrawer && (
          <button onClick={closeNav} className="p-2 rounded-lg hover:bg-[var(--bl-sidebar-hover)]" aria-label="Close navigation">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        {renderSidebarNav(closeNav)}
      </nav>

      <div className="p-4 border-t bl-sidebar-header">
        <div className="bl-card p-4">
          <div className="label-eyebrow text-[10px]">Signed in</div>
          <div className="mt-1 text-sm font-medium text-[var(--bl-sidebar-text)]" data-testid="current-user-name">{user?.name}</div>
          <div className="text-xs text-[var(--bl-sidebar-muted-text)]">{user?.role_name || ROLE_LABEL[user?.role]}</div>
          <button onClick={logout} className="mt-3 w-full bl-btn-secondary text-sm flex items-center justify-center gap-2" data-testid="logout-button">
            <LogOut className="w-4 h-4" strokeWidth={1.6} /> Logout
          </button>
          <button type="button" onClick={() => { setHelpOpen(true); closeNav(); }} className="mt-2 w-full bl-btn-secondary text-sm flex items-center justify-center gap-2" data-testid="help-support-btn">
            <LifeBuoy className="w-4 h-4" strokeWidth={1.6} /> Help & Support
          </button>
          <InstallAppPrompt compact />
        </div>
      </div>
    </div>
    );
  };

  return (
    <RealtimeEventsProvider>
    <FrontDeskReminderProvider>
    <div
      className={`flex ${appointmentWorkspaceActive ? "h-screen overflow-hidden" : "min-h-screen"}`}
      style={{ background: "var(--bl-background)" }}
      data-appointment-workspace={appointmentWorkspaceActive ? "true" : "false"}
    >
      <ExpiryGate />
      {/* Desktop sidebar */}
      {!appointmentWorkspaceActive && (
      <aside className="hidden lg:flex" data-testid="app-sidebar">
        <Sidebar />
      </aside>
      )}

      {appointmentWorkspaceActive && isNavigationDrawerOpen && (
        <>
          <div
            className="fixed inset-0 z-[80] bg-[#2D3A33]/40"
            onClick={closeNavigationDrawer}
            data-testid="appointment-nav-drawer-overlay"
            aria-hidden
          />
          <aside
            className="fixed top-0 left-0 bottom-0 w-72 max-w-[85vw] z-[90] shadow-2xl"
            data-testid="appointment-nav-drawer"
          >
            <Sidebar inDrawer onClose={closeNavigationDrawer} />
          </aside>
        </>
      )}

      {/* Mobile drawer (overflow nav) */}
      {mobileOpen && (
        <>
          <div className="bl-mobile-overlay lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed top-0 left-0 bottom-0 w-72 z-50 lg:hidden">
            <Sidebar inDrawer onClose={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      {/* Main */}
      <main className={`flex-1 min-w-0 flex flex-col ${appointmentWorkspaceActive ? "min-h-0 overflow-hidden" : ""}`}>
        {showBetaBadge && !appointmentWorkspaceActive && (
          <div className="px-4 py-2 text-xs font-semibold text-amber-900 bg-amber-100 border-b border-amber-200 text-center tracking-wide">
            ClinicOS Beta Environment
          </div>
        )}
        <ImpersonationBanner />
        {!appointmentWorkspaceActive && <BillingNotificationBanner />}
        {!appointmentWorkspaceActive && <UsageWarningBanner />}
        {!appointmentWorkspaceActive && <SubscriptionBanner />}
        {!appointmentWorkspaceActive && <PlatformAnnouncementBanner />}
        {/* Mobile top bar — hidden on visit workflow for more vertical space */}
        <header
          className={`lg:hidden sticky top-0 z-30 backdrop-blur border-b px-4 py-3 flex items-center justify-between ${isVisitWorkflowPage || appointmentWorkspaceActive ? "hidden" : ""}`}
          style={{ background: "color-mix(in srgb, var(--bl-background) 95%, transparent)", borderColor: "var(--bl-border)" }}
          data-testid="mobile-app-header"
        >
          <button onClick={() => setMobileOpen(true)} className="p-2 -ml-2 rounded-lg active:bg-[var(--bl-primary-soft)]" data-testid="mobile-menu-button" aria-label="Menu">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            {branding?.logo_path ? (
              <img src={logoUrl(branding.logo_path)} alt="logo" className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--bl-primary)", color: "var(--bl-primary-contrast)" }}>
                <Sparkles className="w-4 h-4" />
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
          className={`flex-1 ${appointmentWorkspaceActive ? "min-h-0 overflow-hidden flex flex-col" : `lg:pb-0 ${isVisitWorkflowPage ? "pb-[12.5rem]" : "pb-[calc(6rem+env(safe-area-inset-bottom,0px))]"}`}`}
          data-visit-workflow={isVisitWorkflowPage ? "true" : undefined}
        >
          {children}
        </div>

        {/* Mobile bottom navigation */}
        {!appointmentWorkspaceActive && (
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
                  <span className="text-[10px] font-medium" style={{ color: active ? "var(--bl-text)" : "#5C6C62" }}>{navDisplayLabel(n, user?.role, { short: true })}</span>
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
        )}

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

              <div className="mb-3">
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
      <FrontDeskReminderLayer />
    </div>
    </FrontDeskReminderProvider>
    </RealtimeEventsProvider>
  );
}
