import { TYPE_BADGE_CLASS, TYPE_LABELS } from "@/lib/posUtils";

export default function PosItemTypeBadge({ type }) {
  const cls = TYPE_BADGE_CLASS[type] || TYPE_BADGE_CLASS.custom;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {TYPE_LABELS[type] || type}
    </span>
  );
}
