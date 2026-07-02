import {
  BookOpen,
  Calculator,
  ClipboardList,
  FileText,
  Hourglass,
  Receipt,
  ShoppingCart,
  Stethoscope,
} from "lucide-react";
import { UTILITY_ITEMS } from "@/components/bookings/scheduleUtilityPermissions";

const ICONS = {
  price_checker: Calculator,
  invoices: FileText,
  pos: ShoppingCart,
  sessions: Stethoscope,
  waiting_list: Hourglass,
  daily_closing: Receipt,
  appointment_log: ClipboardList,
  legend: BookOpen,
};

export const UTILITY_RAIL_WIDTH_PX = 80;

export default function ScheduleFullscreenUtilityRail({ access, activeId, onSelect }) {
  const visible = UTILITY_ITEMS.filter((item) => access[item.permissionKey]);

  if (!visible.length) return null;

  return (
    <aside
      className="relative z-[120] shrink-0 flex flex-col border-l border-[#EAE6D7] bg-[#F8F5EC] overflow-y-auto"
      style={{ width: UTILITY_RAIL_WIDTH_PX }}
      data-testid="schedule-utility-rail"
    >
      <div className="py-2 px-1 flex flex-col gap-1">
        {visible.map((item) => {
          const Icon = ICONS[item.id];
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(active ? null : item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-2 px-1 text-center transition ${
                active
                  ? "bg-white text-[#2D3A33] shadow-sm ring-2 ring-[#52796F]/40"
                  : "text-[#5C6C62] hover:bg-white hover:text-[#2D3A33]"
              }`}
              data-testid={`schedule-utility-${item.id}`}
              title={item.label}
            >
              {Icon && <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />}
              <span className="text-[9px] font-medium leading-tight max-w-full truncate px-0.5 hidden sm:block">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
