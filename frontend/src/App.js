import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SettingsProvider } from "@/lib/settings";
import LoginPage from "@/pages/LoginPage";
import AppShell from "@/layout/AppShell";
import DashboardPage from "@/pages/DashboardPage";
import PatientsPage from "@/pages/PatientsPage";
import PatientDetailPage from "@/pages/PatientDetailPage";
import VisitDetailPage from "@/pages/VisitDetailPage";
import VisitsPage from "@/pages/VisitsPage";
import AuditPage from "@/pages/AuditPage";
import PrintVisitPage from "@/pages/PrintVisitPage";
import AdminPage from "@/pages/AdminPage";

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#5C6C62]">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function Shell({ children }) { return <AppShell>{children}</AppShell>; }

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/print/visit/:vid" element={<Protected><PrintVisitPage /></Protected>} />
            <Route path="/" element={<Protected><Shell><DashboardPage /></Shell></Protected>} />
            <Route path="/patients" element={<Protected><Shell><PatientsPage /></Shell></Protected>} />
            <Route path="/patients/:pid" element={<Protected><Shell><PatientDetailPage /></Shell></Protected>} />
            <Route path="/visits" element={<Protected><Shell><VisitsPage /></Shell></Protected>} />
            <Route path="/visits/:vid" element={<Protected><Shell><VisitDetailPage /></Shell></Protected>} />
            <Route path="/audit" element={<Protected><Shell><AuditPage /></Shell></Protected>} />
            <Route path="/admin" element={<Protected roles={["super_admin"]}><Shell><AdminPage /></Shell></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SettingsProvider>
    </AuthProvider>
  );
}
