import { Stethoscope, Heart, Shield, MapPin, Ruler } from "lucide-react";
import { useAuth, hasPermission } from "@/lib/auth";
import SettingsModuleLayout from "@/components/settings/SettingsModuleLayout";
import ConsentTemplatesPanel from "@/components/consent/ConsentTemplatesPanel";
import {
  DoctorFormTab,
  TherapistFormTab,
  MappingTab,
  UnitTypesTab,
} from "@/pages/admin/settingsTabs";

export default function FormsPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "super_admin";
  const canForms = isOwner || hasPermission(user, "settings.manage");
  const canConsent = hasPermission(user, "consent.manage") || isOwner || user?.role === "manager";

  const tabs = [
    canForms && { key: "doctor-form", label: "Doctor Form", icon: Stethoscope },
    canForms && { key: "therapist-form", label: "Therapist Form", icon: Heart },
    canConsent && { key: "consent", label: "Consent", icon: Shield },
    canForms && { key: "mapping", label: "Mapping", icon: MapPin },
    canForms && { key: "units", label: "Units", icon: Ruler },
  ].filter(Boolean);

  return (
    <SettingsModuleLayout
      eyebrow="Clinical"
      title="Session settings"
      description="Configure doctor/therapist visit forms, consent templates, mapping canvases, and visit unit types."
      tabs={tabs}
      defaultTab="doctor-form"
      testIdPrefix="visit-settings"
    >
      {(tab) => (
        <>
          {tab === "doctor-form" && canForms && <DoctorFormTab />}
          {tab === "therapist-form" && canForms && <TherapistFormTab />}
          {tab === "consent" && canConsent && <ConsentTemplatesPanel embedded />}
          {tab === "mapping" && canForms && <MappingTab />}
          {tab === "units" && canForms && <UnitTypesTab />}
        </>
      )}
    </SettingsModuleLayout>
  );
}
