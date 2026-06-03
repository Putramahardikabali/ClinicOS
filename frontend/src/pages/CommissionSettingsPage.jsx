import { Navigate } from "react-router-dom";

export default function CommissionSettingsPage() {
  return <Navigate to="/finance-settings?tab=commission" replace />;
}
