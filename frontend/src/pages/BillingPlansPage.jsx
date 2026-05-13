import { useMemo, useState } from "react";
import { useClinic, formatIdr, trialDaysLeft } from "@/lib/clinic";
import { PlansGrid } from "@/components/ExpiryGate";
import { Sparkles, Users, Stethoscope, BarChart3, RefreshCw, Check } from "lucide-react";

const QUESTIONS = [
  {
    key: "staff",
    icon: Users,
    title: "How many staff will use the system?",
    options: [
      { value: "small", label: "1–3 people" },
      { value: "medium", label: "4–7 people" },
      { value: "large", label: "8 or more" },
    ],
  },
  {
    key: "emr",
    icon: Stethoscope,
    title: "Do you perform injectables or need full EMR?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No, just basic records" },
    ],
  },
  {
    key: "reports",
    icon: BarChart3,
    title: "Do you need advanced reports & multi-location?",
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
];

function recommend(answers) {
  if (answers.reports === "yes" || answers.staff === "large") return "complete";
  if (answers.emr === "yes" || answers.staff === "medium") return "clinic";
  return "starter";
}

function PlanQuiz({ onResult, recommended }) {
  const [answers, setAnswers] = useState({});
  const done = QUESTIONS.every(q => answers[q.key]);

  const pick = (qkey, val) => {
    const next = { ...answers, [qkey]: val };
    setAnswers(next);
    if (QUESTIONS.every(q => next[q.key])) onResult(recommend(next));
  };
  const reset = () => { setAnswers({}); onResult(null); };

  return (
    <div className="mt-8 bl-card p-6 sm:p-7" data-testid="plan-quiz">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4" style={{ color: "var(--bl-accent)" }} />
        <div className="label-eyebrow">Find your fit</div>
      </div>
      <h2 className="font-display text-2xl text-[#2D3A33]">Answer 3 quick questions — we'll suggest a plan.</h2>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5">
        {QUESTIONS.map((q, i) => {
          const Icon = q.icon;
          return (
            <div key={q.key} className="space-y-3">
              <div className="flex items-center gap-2 text-[#2D3A33]">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-semibold" style={{ background: "#F3F1EB", color: "var(--bl-primary)" }}>{i + 1}</div>
                <Icon className="w-4 h-4 text-[#5C6C62]" />
                <span className="text-sm font-medium">{q.title}</span>
              </div>
              <div className="space-y-1.5">
                {q.options.map(o => {
                  const sel = answers[q.key] === o.value;
                  return (
                    <button
                      key={o.value}
                      onClick={() => pick(q.key, o.value)}
                      className="w-full text-left px-3 py-2 rounded-lg border text-sm transition flex items-center justify-between"
                      style={sel
                        ? { borderColor: "var(--bl-primary)", background: "#EDF3EF", color: "#2D3A33" }
                        : { borderColor: "#EAE6D7", background: "white", color: "#5C6C62" }}
                      data-testid={`quiz-${q.key}-${o.value}`}
                    >
                      <span>{o.label}</span>
                      {sel && <Check className="w-4 h-4" style={{ color: "var(--bl-primary)" }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {done && recommended && (
        <div className="mt-6 pt-5 border-t border-[#EAE6D7] flex items-center justify-between gap-3 flex-wrap" data-testid="quiz-result">
          <div className="text-sm text-[#2D3A33]">
            Based on your answers, we recommend the <strong className="capitalize" style={{ color: "var(--bl-primary)" }}>{recommended}</strong> plan.
          </div>
          <button onClick={reset} className="text-sm inline-flex items-center gap-1 text-[#5C6C62] hover:text-[#2D3A33]" data-testid="quiz-reset">
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      )}
    </div>
  );
}

export default function BillingPlansPage() {
  const { clinic } = useClinic();
  const [recommended, setRecommended] = useState(null);

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

      <PlanQuiz onResult={setRecommended} recommended={recommended} />

      <PlansGrid recommended={recommended} />

      <div className="mt-10 bl-card p-6">
        <div className="label-eyebrow">How payments work</div>
        <p className="text-sm text-[#5C6C62] mt-2">
          ClinicOS uses manual bank transfer for the MVP. After selecting a plan, you'll see our bank account details with a unique transfer code. Upload your payment proof and we'll activate your account within 1×24 hours.
        </p>
      </div>
    </div>
  );
}
