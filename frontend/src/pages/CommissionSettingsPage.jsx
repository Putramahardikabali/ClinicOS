import { Navigate } from "react-router-dom";

export default function CommissionSettingsPage() {
  return <Navigate to="/admin?tab=commission" replace />;
}
