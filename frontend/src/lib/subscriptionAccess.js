import { canSubscribeBilling } from "@/lib/auth";

export function clinicAccessMode(clinic) {
  if (!clinic) return "full";
  return clinic.access_mode || (clinic.readonly ? "billing_only" : "full");
}

export function isSubscriptionLimited(clinic) {
  const mode = clinicAccessMode(clinic);
  return mode === "billing_only" || mode === "blocked";
}

export function canManageSubscription(clinic, user) {
  if (!clinic || !user) return false;
  return user.role === "super_admin" || user.role === "manager" || canSubscribeBilling(user);
}

/** Paths reachable while subscription is expired (billing_only / blocked). */
export function canAccessPathWhenLimited(clinic, pathname, user) {
  if (!isSubscriptionLimited(clinic)) return true;
  const ownerPaths = [/^\/billing/, /^\/help/, /^\/profile/, /^\/account/];
  const staffPaths = [/^\/help/, /^\/profile/, /^\/account/];
  const patterns = canManageSubscription(clinic, user) ? ownerPaths : staffPaths;
  return patterns.some((p) => p.test(pathname || ""));
}

export function subscriptionWasTrial(clinic) {
  const sub = clinic?.subscription || {};
  return sub.plan === "trial" || Boolean(sub.trial_end);
}

export function limitedAccessMessage(clinic, user) {
  if (canManageSubscription(clinic, user)) {
    if (subscriptionWasTrial(clinic)) {
      return {
        title: "Your trial has ended",
        body: "Please renew your subscription to continue using ClinicOS.",
        showBillingCta: true,
      };
    }
    return {
      title: "Your subscription has expired",
      body: "Please renew your subscription to continue using ClinicOS.",
      showBillingCta: true,
    };
  }
  return {
    title: "Clinic access paused",
    body: "Your clinic subscription has expired. Please contact your clinic owner or manager.",
    showBillingCta: false,
  };
}
