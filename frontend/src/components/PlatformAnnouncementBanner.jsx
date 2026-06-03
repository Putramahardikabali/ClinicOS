import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import api from "@/lib/api";

const SEVERITY = {
  info: { bg: "#E8F0EC", border: "#C5D9CE", text: "#2D4A3E", icon: "#3F5A52" },
  success: { bg: "#EEF5EA", border: "#C8DDB8", text: "#2D4A3E", icon: "#5A7A52" },
  warning: { bg: "#FBF3E4", border: "#E8D4A8", text: "#5C4A2E", icon: "#B8860B" },
};

export default function PlatformAnnouncementBanner() {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("bl_ann_dismissed") || "[]"));
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    api.get("/announcements/active")
      .then((r) => setItems(Array.isArray(r.data) ? r.data : r.data ? [r.data] : []))
      .catch(() => setItems([]));
  }, []);

  const visible = items.filter((a) => !dismissed.has(a.id));
  if (!visible.length) return null;

  const dismiss = (id) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    localStorage.setItem("bl_ann_dismissed", JSON.stringify([...next]));
  };

  return (
    <div className="space-y-2 px-4 lg:px-8 pt-3">
      {visible.map((ann) => {
        const style = SEVERITY[ann.severity] || SEVERITY.info;
        return (
          <div
            key={ann.id}
            className="rounded-xl px-4 py-3 flex items-start gap-3 text-sm"
            style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.text }}
            data-testid={`platform-announcement-${ann.id}`}
          >
            <Megaphone className="w-4 h-4 shrink-0 mt-0.5" style={{ color: style.icon }} />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{ann.title}</div>
              <div className="mt-0.5 opacity-90">{ann.body}</div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(ann.id)}
              className="p-1 rounded hover:opacity-70 shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
