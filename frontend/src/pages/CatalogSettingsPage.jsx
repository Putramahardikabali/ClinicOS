import { Pill, Ruler } from "lucide-react";
import { useAuth, hasPermission } from "@/lib/auth";
import SettingsModuleLayout from "@/components/settings/SettingsModuleLayout";
import { TreatmentCategoriesTab, UnitTypesTab } from "@/pages/admin/settingsTabs";

export default function CatalogSettingsPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "super_admin";
  const canCatalog =
    isOwner
    || hasPermission(user, "treatments.manage")
    || hasPermission(user, "packages_catalog.manage");

  const tabs = [
    canCatalog && { key: "treatment-categories", label: "Treatment Categories", icon: Pill },
    canCatalog && { key: "unit-types", label: "Unit Types", icon: Ruler },
  ].filter(Boolean);

  return (
    <SettingsModuleLayout
      eyebrow="Clinic"
      title="Catalog Settings"
      description="Manage reusable catalog options used across treatments, packages, and visit records."
      tabs={tabs}
      defaultTab="treatment-categories"
      testIdPrefix="catalog-settings"
    >
      {(tab) => (
        <>
          {tab === "treatment-categories" && canCatalog && <TreatmentCategoriesTab />}
          {tab === "unit-types" && canCatalog && <UnitTypesTab />}
        </>
      )}
    </SettingsModuleLayout>
  );
}
