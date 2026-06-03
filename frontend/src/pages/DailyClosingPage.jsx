import { useState } from "react";
import ClosingTodayTab from "@/components/closing/ClosingTodayTab";
import ClosingHistoryTab from "@/components/closing/ClosingHistoryTab";

const TABS = [
  { id: "today", label: "Today Closing" },
  { id: "history", label: "Closing History" },
];

export default function DailyClosingPage() {
  const [tab, setTab] = useState("today");

  return (
    <div className="p-3 sm:p-6 md:p-8 max-w-[1200px] mx-auto" data-testid="daily-closing-page">
      <div className="mb-4 sm:mb-6">
        <div className="label-eyebrow">Finance</div>
        <h1 className="font-display text-2xl sm:text-3xl text-[#2D3A33] mt-1">Daily Closing</h1>
        <p className="text-sm text-[#5C6C62] mt-1">
          Review paid POS sales and visit invoice payments, reconcile cash, and close the business day.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 mb-6 border-b border-[#EAE6D7] pb-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-[var(--bl-primary)] text-[var(--bl-primary)]"
                : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"
            }`}
            data-testid={`closing-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "today" && <ClosingTodayTab />}
      {tab === "history" && <ClosingHistoryTab />}
    </div>
  );
}
