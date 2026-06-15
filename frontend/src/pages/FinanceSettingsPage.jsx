import { Navigate, useSearchParams } from "react-router-dom";

/** Legacy route — redirects into General Settings. */
export default function FinanceSettingsPage() {
  const [search] = useSearchParams();
  const legacyTab = search.get("tab");
  if (legacyTab === "campaigns" || legacyTab === "coupons") return <Navigate to="/campaigns" replace />;
  if (legacyTab === "loyalty") return <Navigate to="/loyalty" replace />;
  const targetTab = legacyTab === "online-booking-payment" ? "online-booking-payment" : "commission";
  return <Navigate to={`/admin?tab=${targetTab}`} replace />;
}
