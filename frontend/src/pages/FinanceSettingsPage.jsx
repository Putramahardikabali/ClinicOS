import { Navigate, useSearchParams } from "react-router-dom";
import { Percent, CreditCard } from "lucide-react";
import { useAuth, hasPermission } from "@/lib/auth";
import { useClinic, hasFeature } from "@/lib/clinic";
import { FeatureRoute } from "@/components/FeatureGate";
import SettingsModuleLayout from "@/components/settings/SettingsModuleLayout";
import CommissionSettingsPanel from "@/components/commission/CommissionSettingsPanel";
import { OnlineBookingPaymentTab } from "@/pages/admin/settingsTabs";

export default function FinanceSettingsPage() {
  const [search] = useSearchParams();
  const legacyTab = search.get("tab");
  if (legacyTab === "campaigns" || legacyTab === "coupons") return <Navigate to="/campaigns" replace />;
  if (legacyTab === "loyalty") return <Navigate to="/loyalty" replace />;

  const { user } = useAuth();
  const { clinic } = useClinic();
  const isOwner = user?.role === "super_admin";

  const canCommission =
    hasPermission(user, "commission.manage") && hasFeature(clinic, "commissions");
  const canBilling =
    (isOwner || hasPermission(user, "billing.manage") || hasPermission(user, "settings.manage"))
    && hasFeature(clinic, "online_booking_payment");

  const tabs = [
    canCommission && { key: "commission", label: "Commission", icon: Percent },
    canBilling && { key: "online-booking-payment", label: "Online appointment payment", icon: CreditCard },
  ].filter(Boolean);

  return (
    <SettingsModuleLayout
      eyebrow="Finance"
      title="Finance Settings"
      description="Commission rules and online booking payment configuration."
      tabs={tabs}
      defaultTab={canCommission ? "commission" : "online-booking-payment"}
      testIdPrefix="finance-settings"
    >
      {(tab) => (
        <>
          {tab === "commission" && canCommission && (
            <FeatureRoute feature="commissions"><CommissionSettingsPanel /></FeatureRoute>
          )}
          {tab === "online-booking-payment" && canBilling && isOwner && (
            <FeatureRoute feature="online_booking_payment"><OnlineBookingPaymentTab /></FeatureRoute>
          )}
        </>
      )}
    </SettingsModuleLayout>
  );
}
