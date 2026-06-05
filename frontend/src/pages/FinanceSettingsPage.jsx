import { Percent, CreditCard, Tag, Award } from "lucide-react";
import { useAuth, hasPermission } from "@/lib/auth";
import { useClinic, hasFeature } from "@/lib/clinic";
import { FeatureRoute } from "@/components/FeatureGate";
import SettingsModuleLayout from "@/components/settings/SettingsModuleLayout";
import CommissionSettingsPanel from "@/components/commission/CommissionSettingsPanel";
import {
  OnlineBookingPaymentTab,
  CouponsTab,
  LoyaltyTab,
} from "@/pages/admin/settingsTabs";

export default function FinanceSettingsPage() {
  const { user } = useAuth();
  const { clinic } = useClinic();
  const isOwner = user?.role === "super_admin";
  const isManager = user?.role === "manager";

  const canCommission =
    hasPermission(user, "commission.manage") && hasFeature(clinic, "commissions");
  const canBilling =
    (isOwner || hasPermission(user, "billing.manage") || hasPermission(user, "settings.manage"))
    && hasFeature(clinic, "online_booking_payment");
  const canCoupons = hasPermission(user, "coupons.manage");
  const canLoyalty = isOwner || isManager;

  const tabs = [
    canCommission && { key: "commission", label: "Commission", icon: Percent },
    canBilling && { key: "online-booking-payment", label: "Online appointment payment", icon: CreditCard },
    canCoupons && { key: "coupons", label: "Coupons", icon: Tag },
    canLoyalty && { key: "loyalty", label: "Loyalty", icon: Award },
  ].filter(Boolean);

  return (
    <SettingsModuleLayout
      eyebrow="Finance"
      title="Finance Settings"
      description="Commission rules, online booking payments, coupons, and loyalty programs."
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
          {tab === "coupons" && canCoupons && <CouponsTab />}
          {tab === "loyalty" && canLoyalty && <LoyaltyTab />}
        </>
      )}
    </SettingsModuleLayout>
  );
}
