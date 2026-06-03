import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useClinic, trialDaysLeft } from "@/lib/clinic";
import { PlansGrid } from "@/components/PlansGrid";
import CurrentSubscriptionCard from "@/components/CurrentSubscriptionCard";
import { computePlanCharge, upgradePlanKeys, PLAN_ORDER } from "@/lib/billing";
import { useAuth, canSubscribeBilling, canViewSaasBilling } from "@/lib/auth";
import api from "@/lib/api";

export default function BillingPlansPage() {
  const { clinic, plans } = useClinic();
  const { user } = useAuth();
  const nav = useNavigate();
  const canSubscribe = canSubscribeBilling(user);
  const canViewSaas = canViewSaasBilling(user);
  const [highlightPlan, setHighlightPlan] = useState(null);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [staffCount, setStaffCount] = useState(null);
  const [payments, setPayments] = useState([]);
  const [planChangeRequests, setPlanChangeRequests] = useState([]);
  const [requestPlan, setRequestPlan] = useState("clinic");
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);

  useEffect(() => {
    if (clinic?.usage?.staff_count != null) {
      setStaffCount(clinic.usage.staff_count);
    }
    if (!canViewSaas) return;
    api.get("/billing/cycles").catch(() => {});
    api.get("/billing/quote", { params: { plan: "clinic", cycle: billingCycle } }).catch(() => {});
    if (!canSubscribe) return;
    api.get("/billing/payment-requests")
      .then((r) => setPayments(r.data || []))
      .catch(() => setPayments([]));
    api.get("/billing/plan-change-requests")
      .then((r) => setPlanChangeRequests(r.data || []))
      .catch(() => setPlanChangeRequests([]));
  }, [canSubscribe, canViewSaas, billingCycle, clinic?.usage?.staff_count]);

  const submitPlanChangeRequest = async () => {
    setRequestBusy(true);
    try {
      await api.post("/billing/plan-change-request", {
        requested_plan: requestPlan,
        billing_cycle: billingCycle,
        note: requestNote.trim() || null,
      });
      toast.success("Plan change request submitted — our team will review it");
      setRequestNote("");
      const r = await api.get("/billing/plan-change-requests");
      setPlanChangeRequests(r.data || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not submit request");
    } finally {
      setRequestBusy(false);
    }
  };

  const pendingPlanChange = planChangeRequests.find((r) => r.status === "pending");

  const sub = clinic?.subscription || {};

  const days = trialDaysLeft(clinic);

  const currentPlanKey = sub.status === "trial" ? null : sub.plan;

  const currentPlan = plans.find((p) => p.key === currentPlanKey);

  const quotePlan =

    currentPlan || plans.find((p) => p.key === "clinic") || plans[0];

  const upgrades = upgradePlanKeys(currentPlanKey || "starter");

  const onHighestPlan = upgrades.length === 0 && currentPlanKey === "complete";



  const planDetailsForUsage =
    clinic?.plan_details
    || (sub.status === "trial" ? plans.find((p) => p.key === "complete") : quotePlan);

  const currentCharge = useMemo(() => {
    if (!quotePlan) return null;
    return computePlanCharge(quotePlan.price_idr, billingCycle);
  }, [quotePlan, billingCycle]);



  const goCheckout = (planKey, action = "subscribe") => {

    nav(`/billing/checkout?plan=${planKey}&cycle=${billingCycle}&action=${action}`);

  };



  if (!clinic) return <div className="p-10 text-[#5C6C62]">Loading…</div>;



  return (

    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">

      <div className="label-eyebrow">Subscription</div>

      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">

        Plans & billing

      </h1>

      <p className="mt-2 text-[#5C6C62]">Choose the plan that fits your clinic. You can change or cancel any time.</p>



      <CurrentSubscriptionCard

        sub={sub}

        trialDays={days}

        currentPlan={quotePlan}

        currentCharge={currentCharge}

        billingCycle={billingCycle}

        onBillingCycleChange={setBillingCycle}

        onRenew={() => canSubscribe && goCheckout(currentPlanKey, "renew")}

        onSubscribe={() => canSubscribe && goCheckout("clinic", "subscribe")}

        onUpgrade={() => {
          if (!canSubscribe) return;
          const target = upgrades[upgrades.length - 1];
          document.getElementById("plans-grid")?.scrollIntoView({ behavior: "smooth" });
          setHighlightPlan(target);
        }}

        showRenew={canSubscribe && Boolean(currentPlanKey && PLAN_ORDER.includes(currentPlanKey))}

        showSubscribe={canSubscribe && sub.status === "trial"}

        showUpgrade={canSubscribe && !onHighestPlan && upgrades.length > 0}

        onHighestPlan={onHighestPlan}

        planDetails={planDetailsForUsage}

        usage={clinic.usage}

        staffCount={staffCount}

      />

      {canSubscribe && payments.length > 0 && (
        <div className="mt-8 bl-card p-6">
          <div className="label-eyebrow">Payment history</div>
          <h2 className="font-display text-xl text-[#2D3A33] mt-1">Your payment requests</h2>
          <ul className="mt-4 space-y-2">
            {payments.slice(0, 8).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm py-2 border-b border-[#EAE6D7] last:border-0">
                <span className="text-[#2D3A33] capitalize">{p.plan} · {p.billing_cycle || "monthly"}</span>
                <span className="text-[#5C6C62]">Rp {Number(p.amount_idr || 0).toLocaleString("id-ID")}</span>
                <span className={`text-xs uppercase tracking-widest ${p.status === "verified" ? "text-[#52796F]" : p.status === "rejected" ? "text-[#B14A2C]" : "text-[#8A6D1F]"}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canSubscribe && (
      <div className="mt-8 bl-card p-6">
        <div className="label-eyebrow">Plan change</div>
        <h2 className="font-display text-xl text-[#2D3A33] mt-1">Request upgrade or downgrade</h2>
        <p className="text-sm text-[#5C6C62] mt-2">
          Submit a request and our team will review it. You can also subscribe immediately via checkout below.
        </p>
        {pendingPlanChange ? (
          <div className="mt-4 p-4 rounded-xl bg-[#F5F2EA] border border-[#EAE6D7] text-sm text-[#2D3A33]">
            Pending request: <strong className="capitalize">{pendingPlanChange.current_plan}</strong> →{" "}
            <strong className="capitalize">{pendingPlanChange.requested_plan}</strong> ({pendingPlanChange.billing_cycle})
          </div>
        ) : (
          <div className="mt-4 grid sm:grid-cols-2 gap-3 max-w-xl">
            <label className="text-sm">
              <span className="text-xs uppercase tracking-widest text-[#5C6C62]">Requested plan</span>
              <select value={requestPlan} onChange={(e) => setRequestPlan(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-[#EAE6D7] bg-white text-[#2D3A33]">
                {plans.filter((p) => PLAN_ORDER.includes(p.key)).map((p) => (
                  <option key={p.key} value={p.key}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-xs uppercase tracking-widest text-[#5C6C62]">Note (optional)</span>
              <textarea value={requestNote} onChange={(e) => setRequestNote(e.target.value)} rows={2} placeholder="Why do you want to change plans?" className="mt-1 w-full px-3 py-2 rounded-lg border border-[#EAE6D7] bg-white text-[#2D3A33]" />
            </label>
            <button type="button" disabled={requestBusy} onClick={submitPlanChangeRequest} className="sm:col-span-2 px-4 py-2.5 rounded-xl text-sm text-white bg-[#52796F] disabled:opacity-50">
              {requestBusy ? "Submitting…" : "Submit plan change request"}
            </button>
          </div>
        )}
        {planChangeRequests.filter((r) => r.status !== "pending").length > 0 && (
          <ul className="mt-4 space-y-2 text-sm text-[#5C6C62]">
            {planChangeRequests.filter((r) => r.status !== "pending").slice(0, 5).map((r) => (
              <li key={r.id} className="capitalize">
                {r.requested_plan} · {r.status}
                {r.resolution_reason ? ` — ${r.resolution_reason}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      <div id="plans-grid">

        <PlansGrid recommended={highlightPlan} billingCycle={billingCycle} canSubscribe={canSubscribe && canViewSaas} />

      </div>



      <div className="mt-10 bl-card p-6">

        <div className="label-eyebrow">How payments work</div>

        <ol className="mt-3 space-y-2.5 text-sm text-[#5C6C62] list-decimal list-inside">

          <li>Choose a plan and billing period.</li>

          <li>We generate bank transfer instructions with a unique payment code.</li>

          <li>Upload your payment proof.</li>

          <li>Your subscription is activated after verification.</li>

        </ol>

        <p className="text-sm text-[#5C6C62] mt-4">

          Manual verification usually takes up to 24 hours.

        </p>

        <p className="text-sm text-[#5C6C62] mt-3 pt-3 border-t border-[#EAE6D7]">

          <strong>6 months</strong> saves 5% and <strong>annual</strong> billing saves 10% versus paying month to month.

        </p>

      </div>

    </div>

  );

}

