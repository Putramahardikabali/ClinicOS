import { useClinic, formatIdr, trialDaysLeft } from "@/lib/clinic";
import { PlansGrid } from "@/components/ExpiryGate";

export default function BillingPlansPage() {
  const { clinic } = useClinic();
  if (!clinic) return <div className="p-10 text-[#5C6C62]">Loading…</div>;
  const sub = clinic.subscription || {};
  const days = trialDaysLeft(clinic);

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <div className="label-eyebrow">Subscription</div>
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">Plans & billing</h1>
      <p className="mt-2 text-[#5C6C62]">Choose the plan that fits your clinic. You can change or cancel any time.</p>

      <div className="mt-6 bl-card p-5 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between" data-testid="current-plan-badge">
        <div>
          <div className="label-eyebrow">Current plan</div>
          <div className="font-display text-2xl text-[#2D3A33] mt-1 capitalize" data-testid="current-plan-name">{sub.plan}</div>
          <div className="text-sm text-[#5C6C62] mt-1" data-testid="current-plan-status">
            {sub.status === "trial" && days !== null && <span>Trial · ends in {days} day{days !== 1 ? "s" : ""}</span>}
            {sub.status === "active" && sub.expiry_date && <span>Renews on {new Date(sub.expiry_date).toLocaleDateString()}</span>}
            {sub.status === "expired" && <span className="text-[#B14A2C]">Expired — read-only mode</span>}
          </div>
        </div>
      </div>

      <PlansGrid />

      <div className="mt-10 bl-card p-6">
        <div className="label-eyebrow">How payments work</div>
        <p className="text-sm text-[#5C6C62] mt-2">
          ClinicOS uses manual bank transfer for the MVP. After selecting a plan, you'll see our bank account details with a unique transfer code. Upload your payment proof and we'll activate your account within 1×24 hours.
        </p>
      </div>
    </div>
  );
}
