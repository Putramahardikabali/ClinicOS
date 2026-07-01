import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SettingsProvider } from "@/lib/settings";
import { ClinicProvider, useClinic } from "@/lib/clinic";
import { InstallAppProvider } from "@/lib/installApp";
import LoginPage from "@/pages/LoginPage";
import DemoPage from "@/pages/DemoPage";
import RegisterPage from "@/pages/RegisterPage";
import OnboardingPage from "@/pages/OnboardingPage";
import AppShell from "@/layout/AppShell";
import DashboardPage from "@/pages/DashboardPage";
import FrontDeskDashboardPage from "@/pages/FrontDeskDashboardPage";
import PatientsPage from "@/pages/PatientsPage";
import PatientDetailPage from "@/pages/PatientDetailPage";
import VisitDetailPage from "@/pages/VisitDetailPage";
import VisitsPage from "@/pages/VisitsPage";
import AuditPage from "@/pages/AuditPage";
import PrintVisitPage from "@/pages/PrintVisitPage";
import PrintReceiptPage from "@/pages/PrintReceiptPage";
import AdminPage from "@/pages/AdminPage";
import MessagingPage from "@/pages/MessagingPage";
import FormsPage from "@/pages/FormsPage";
import FinanceSettingsPage from "@/pages/FinanceSettingsPage";
import CampaignsPage from "@/pages/marketing/CampaignsPage";
import LoyaltyPage from "@/pages/marketing/LoyaltyPage";
import PatientLabelsPage from "@/pages/settings/PatientLabelsPage";
import { legacyAdminTabRedirect } from "@/lib/settingsNavigation";
import StaffPage from "@/pages/StaffPage";
import StaffProfilePage from "@/pages/StaffProfilePage";
import { hasPermission } from "@/lib/auth";
import ReportsPage from "@/pages/ReportsPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import BillingPlansPage from "@/pages/BillingPlansPage";
import BillingCheckoutPage from "@/pages/BillingCheckoutPage";
import HelpPage from "@/pages/HelpPage";
import BookingsPage from "@/pages/BookingsPage";
import PublicBookingPage from "@/pages/PublicBookingPage";
import PublicConsentPage from "@/pages/PublicConsentPage";
import TreatmentsPage from "@/pages/TreatmentsPage";
import ConsentTemplatesPage from "@/pages/ConsentTemplatesPage";
import PackagesPage from "@/pages/PackagesPage";
import ProductsPage from "@/pages/ProductsPage";
import POSPage from "@/pages/POSPage";
import DailyClosingPage from "@/pages/DailyClosingPage";
import GiftCardsPage from "@/pages/GiftCardsPage";
import PrintClosingPage from "@/pages/PrintClosingPage";
import SchedulePage from "@/pages/SchedulePage";
import ProfilePage from "@/pages/ProfilePage";
import InvoicesPage from "@/pages/InvoicesPage";
import InvoiceDetailPage from "@/pages/InvoiceDetailPage";
import InvoicesOpenVisitPage from "@/pages/InvoicesOpenVisitPage";
import PrintInvoicePage from "@/pages/PrintInvoicePage";
import SuperAdminApp from "@/pages/SuperAdminApp";
import { FeatureRoute } from "@/components/FeatureGate";

function LegacyCommissionRedirect() {
  const loc = useLocation();
  if (loc.pathname.startsWith("/commissions/settings")) {
    return <Navigate to="/admin?tab=commission" replace />;
  }
  return <Navigate to="/staff/directory" replace />;
}

function Protected({ children, roles, permission, anyPermission }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#5C6C62]">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  const roleOk = roles && roles.includes(user.role);
  const permOk = permission && hasPermission(user, permission);
  const anyPermOk = anyPermission?.some((p) => hasPermission(user, p));
  if (anyPermission) {
    if (!anyPermOk && !roleOk) return <Navigate to="/" replace />;
  } else if (permission) {
    if (!permOk && !roleOk) return <Navigate to="/" replace />;
  } else if (roles && !roleOk) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function LegacyAdminRedirect() {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const tab = params.get("tab");
  const target = legacyAdminTabRedirect(tab);
  if (target) return <Navigate to={target} replace />;
  return null;
}

// Redirect new clinics to onboarding until completed
function OnboardingRedirect({ children }) {
  const { clinic, loading } = useClinic();
  const loc = useLocation();
  const allowedWhenLimited =
    loc.pathname.startsWith("/billing")
    || loc.pathname.startsWith("/help")
    || loc.pathname.startsWith("/profile")
    || loc.pathname.startsWith("/account");
  if (loading || !clinic) return children;
  if (allowedWhenLimited && (clinic.access_mode === "billing_only" || clinic.readonly)) return children;
  if (clinic.onboarded === false && loc.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

function Shell({ children }) { return <AppShell>{children}</AppShell>; }

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <ClinicProvider>
          <InstallAppProvider>
          <BrowserRouter>
            <Toaster position="top-right" richColors />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/demo" element={<DemoPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/book/:slug" element={<PublicBookingPage />} />
              <Route path="/consent/:token" element={<PublicConsentPage />} />
              <Route path="/superadmin/*" element={<SuperAdminApp />} />
              <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />
              <Route path="/print/visit/:vid" element={<Protected><FeatureRoute feature="emr"><PrintVisitPage /></FeatureRoute></Protected>} />
              <Route path="/print/receipt/:vid" element={<Protected><PrintReceiptPage /></Protected>} />
              <Route path="/print/invoice/:id" element={<Protected><PrintInvoicePage /></Protected>} />
              <Route path="/print/closing/:id" element={<Protected anyPermission={["closing.view", "accounting.view"]}><PrintClosingPage /></Protected>} />
              <Route path="/" element={<Protected><OnboardingRedirect><Shell><DashboardPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/front-desk" element={<Protected anyPermission={["appointments.view", "accounting.view", "closing.view"]} roles={["fo", "manager", "super_admin"]}><OnboardingRedirect><Shell><FrontDeskDashboardPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/patients" element={<Protected><OnboardingRedirect><Shell><PatientsPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/patients/:pid" element={<Protected><OnboardingRedirect><Shell><PatientDetailPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/visits" element={<Protected><OnboardingRedirect><Shell><FeatureRoute feature="emr"><VisitsPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/visits/:vid" element={<Protected><OnboardingRedirect><Shell><VisitDetailPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/schedule" element={<Protected permission="schedule.view_own"><OnboardingRedirect><Shell><SchedulePage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/account" element={<Protected><OnboardingRedirect><Shell><ProfilePage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/profile" element={<Navigate to="/account" replace />} />
              <Route path="/invoices" element={<Protected anyPermission={["billing.view", "invoices.view"]}><OnboardingRedirect><Shell><FeatureRoute feature="billing"><InvoicesPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/invoices/visit/:visitId" element={<Protected anyPermission={["billing.view", "invoices.view"]}><OnboardingRedirect><Shell><FeatureRoute feature="billing"><InvoicesOpenVisitPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/invoices/:id" element={<Protected anyPermission={["billing.view", "invoices.view"]}><OnboardingRedirect><Shell><FeatureRoute feature="billing"><InvoiceDetailPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/bookings" element={<Protected permission="appointments.view"><OnboardingRedirect><Shell><FeatureRoute feature="online_booking"><BookingsPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/treatments" element={<Protected permission="treatments.manage"><OnboardingRedirect><Shell><FeatureRoute feature="treatments"><TreatmentsPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/consent-templates" element={<Protected permission="consent.manage" roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><FeatureRoute feature="consent"><ConsentTemplatesPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/packages" element={<Protected anyPermission={["packages_catalog.manage", "packages.view"]}><OnboardingRedirect><Shell><FeatureRoute feature="packages"><PackagesPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/products" element={<Protected permission="products.manage" roles={["super_admin", "fo", "manager"]}><OnboardingRedirect><Shell><FeatureRoute feature="products"><ProductsPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/pos" element={<Protected anyPermission={["pos.view", "pos.create"]}><OnboardingRedirect><Shell><FeatureRoute feature="products"><POSPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/daily-closing" element={<Protected anyPermission={["closing.view", "closing.create", "accounting.view"]}><OnboardingRedirect><Shell><FeatureRoute feature="products"><DailyClosingPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/gift-cards" element={<Protected anyPermission={["gift_cards.view", "accounting.view"]}><OnboardingRedirect><Shell><FeatureRoute feature="products"><GiftCardsPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/audit" element={<Protected permission="audit.view" roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><FeatureRoute feature="audit_log"><AuditPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/staff" element={<Navigate to="/staff/directory" replace />} />
              <Route path="/staff/members/:staffId" element={<Protected anyPermission={["staff.view", "commission.view", "commission.view_own", "profile.view_own"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><StaffProfilePage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/staff/:section" element={<Protected anyPermission={["staff.view", "roles.view", "commission.view"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><StaffPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/admin" element={<Protected anyPermission={["settings.view", "commission.manage", "billing.manage", "settings.manage"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><LegacyAdminRedirect /><AdminPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/messaging" element={<Protected anyPermission={["messaging.view", "messaging.manage", "messaging.automation.view", "messaging.automation.manage"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><FeatureRoute feature="whatsapp_automation"><MessagingPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/visit-settings" element={<Protected anyPermission={["settings.manage", "consent.manage"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><FeatureRoute feature="consent"><FormsPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/forms" element={<Navigate to="/visit-settings" replace />} />
              <Route path="/catalog-settings" element={<Navigate to="/treatments" replace />} />
              <Route path="/finance-settings" element={<Protected anyPermission={["commission.manage", "billing.manage", "settings.manage"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><FinanceSettingsPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/campaigns" element={<Protected anyPermission={["campaigns.manage", "campaigns.view", "coupons.manage"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><CampaignsPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/loyalty" element={<Protected anyPermission={["loyalty.manage", "loyalty.view"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><LoyaltyPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/patient-labels" element={<Protected anyPermission={["patient_labels.manage", "patient_labels.view"]} roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><PatientLabelsPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/finance-settings/campaigns" element={<Navigate to="/campaigns" replace />} />
              <Route path="/finance-settings/loyalty" element={<Navigate to="/loyalty" replace />} />
              <Route path="/reports" element={<Protected anyPermission={["reports.view", "billing.view", "accounting.view"]} roles={["super_admin", "manager", "accounting"]}><OnboardingRedirect><Shell><FeatureRoute feature="reports"><ReportsPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/analytics" element={<Protected permission="analytics.view" roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><FeatureRoute feature="reports"><AnalyticsPage /></FeatureRoute></Shell></OnboardingRedirect></Protected>} />
              <Route path="/help" element={<Protected><OnboardingRedirect><Shell><HelpPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/commissions/settings" element={<Protected roles={["super_admin", "manager"]}><OnboardingRedirect><LegacyCommissionRedirect /></OnboardingRedirect></Protected>} />
              <Route path="/commissions/*" element={<Protected roles={["super_admin", "manager"]}><OnboardingRedirect><LegacyCommissionRedirect /></OnboardingRedirect></Protected>} />
              <Route path="/billing/plans" element={<Protected roles={["super_admin", "manager"]}><OnboardingRedirect><Shell><BillingPlansPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/billing/checkout" element={<Protected><OnboardingRedirect><Shell><BillingCheckoutPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          </InstallAppProvider>
        </ClinicProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
