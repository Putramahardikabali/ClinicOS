import { buildVisitChecklist, CHECKLIST_STATUS } from "@/lib/visitUi";

export default function VisitChecklistCard({ visit, invoice, hasMappingFeature, hasPhotosFeature }) {
  const rows = buildVisitChecklist(visit, { invoice, hasMappingFeature, hasPhotosFeature });

  return (
    <div className="bl-card p-5 lg:col-span-2" data-testid="visit-checklist">
      <div className="label-eyebrow mb-3">Visit checklist</div>
      <p className="text-sm text-[#5C6C62] mb-4">
        Use this checklist before submitting or closing the visit. Complete pending items when possible.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => {
          const meta = CHECKLIST_STATUS[row.status] || CHECKLIST_STATUS.pending;
          return (
            <li
              key={row.key}
              className="flex items-center justify-between gap-3 py-2 border-b border-[#EAE6D7] last:border-0 text-sm"
            >
              <span className="text-[#2D3A33]">{row.label}</span>
              <span className="flex items-center gap-2 shrink-0">
                {row.detail && <span className="text-xs text-[#5C6C62]">{row.detail}</span>}
                <span className={`bl-chip ${meta.chip}`}>{meta.label}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
