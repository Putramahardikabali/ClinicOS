/** Legacy Admin Settings ?tab= values → new module routes */
export const LEGACY_ADMIN_TAB_REDIRECTS = {
  messaging: "/messaging",
  messaging_templates: "/messaging?tab=legacy-templates",
  messaging_automation: "/messaging?tab=automation-rules",
  automation: "/messaging?tab=automation-rules",
  doctor: "/visit-settings?tab=doctor-form",
  "doctor-form": "/visit-settings?tab=doctor-form",
  therapist: "/visit-settings?tab=therapist-form",
  "therapist-form": "/visit-settings?tab=therapist-form",
  mapping: "/visit-settings?tab=mapping",
  treatment: "/treatments",
  catalog: "/treatments",
  inventory: "/products?tab=inventory-settings",
  commission: "/finance-settings?tab=commission",
  online_booking_payment: "/finance-settings?tab=online-booking-payment",
  coupons: "/campaigns",
  campaigns: "/campaigns",
  loyalty: "/loyalty",
  users: "/staff/directory",
  staff_schedule: "/staff/schedule",
};

export function legacyAdminTabRedirect(tab) {
  if (!tab) return null;
  return LEGACY_ADMIN_TAB_REDIRECTS[tab] || null;
}
