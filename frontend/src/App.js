import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SettingsProvider } from "@/lib/settings";
import { ClinicProvider, useClinic } from "@/lib/clinic";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import OnboardingPage from "@/pages/OnboardingPage";
import AppShell from "@/layout/AppShell";
import DashboardPage from "@/pages/DashboardPage";
import PatientsPage from "@/pages/PatientsPage";
import PatientDetailPage from "@/pages/PatientDetailPage";
import VisitDetailPage from "@/pages/VisitDetailPage";
import VisitsPage from "@/pages/VisitsPage";
import AuditPage from "@/pages/AuditPage";
import PrintVisitPage from "@/pages/PrintVisitPage";
import AdminPage from "@/pages/AdminPage";
import BillingPlansPage from "@/pages/BillingPlansPage";
import BillingCheckoutPage from "@/pages/BillingCheckoutPage";
import BookingsPage from "@/pages/BookingsPage";
import PublicBookingPage from "@/pages/PublicBookingPage";

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#5C6C62]">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

// Redirect new clinics to onboarding until completed
function OnboardingRedirect({ children }) {
  const { clinic, loading } = useClinic();
  const loc = useLocation();
  if (loading || !clinic) return children;
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
          <BrowserRouter>
            <Toaster position="top-right" richColors />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/book/:slug" element={<PublicBookingPage />} />
              <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />
              <Route path="/print/visit/:vid" element={<Protected><PrintVisitPage /></Protected>} />
              <Route path="/" element={<Protected><OnboardingRedirect><Shell><DashboardPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/patients" element={<Protected><OnboardingRedirect><Shell><PatientsPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/patients/:pid" element={<Protected><OnboardingRedirect><Shell><PatientDetailPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/visits" element={<Protected><OnboardingRedirect><Shell><VisitsPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/visits/:vid" element={<Protected><OnboardingRedirect><Shell><VisitDetailPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/bookings" element={<Protected><OnboardingRedirect><Shell><BookingsPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/audit" element={<Protected><OnboardingRedirect><Shell><AuditPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/admin" element={<Protected roles={["super_admin"]}><OnboardingRedirect><Shell><AdminPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/billing/plans" element={<Protected><OnboardingRedirect><Shell><BillingPlansPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="/billing/checkout" element={<Protected><OnboardingRedirect><Shell><BillingCheckoutPage /></Shell></OnboardingRedirect></Protected>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ClinicProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
