import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Shared shell for focused settings modules (Messaging, Forms, Catalog, Finance).
 */
export default function SettingsModuleLayout({
  eyebrow,
  title,
  description,
  tabs,
  defaultTab,
  testIdPrefix = "module",
  children,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const visibleKeys = useMemo(() => tabs.map((t) => t.key), [tabs]);
  const initialTab = visibleKeys.includes(tabFromUrl) ? tabFromUrl : (defaultTab || visibleKeys[0]);
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    if (tabFromUrl && visibleKeys.includes(tabFromUrl)) {
      setTab(tabFromUrl);
    }
  }, [tabFromUrl, visibleKeys]);

  const selectTab = (key) => {
    setTab(key);
    const next = new URLSearchParams(searchParams);
    if (key === (defaultTab || visibleKeys[0])) {
      next.delete("tab");
    } else {
      next.set("tab", key);
    }
    setSearchParams(next, { replace: true });
  };

  if (!tabs.length) {
    return (
      <div className="p-6 md:p-8 lg:p-10 max-w-7xl">
        <p className="text-sm text-[#5C6C62]">You do not have permission to view this section.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl">
      {eyebrow && <div className="label-eyebrow">{eyebrow}</div>}
      <h1 className="font-display text-3xl sm:text-4xl tracking-tight font-light mt-2 text-[#2D3A33]">{title}</h1>
      {description && <p className="mt-2 text-sm text-[#5C6C62] max-w-2xl">{description}</p>}

      <div
        className="mt-7 border-b border-[#EAE6D7] flex gap-1 overflow-x-auto pb-px -mx-1 px-1"
        data-testid={`${testIdPrefix}-tabs`}
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              className={`px-3 sm:px-4 py-3 text-sm font-medium border-b-2 inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0 transition ${active ? "text-[#2D3A33]" : "border-transparent text-[#5C6C62] hover:text-[#2D3A33]"}`}
              style={active ? { borderColor: "var(--bl-primary)" } : { borderColor: "transparent" }}
              data-testid={`${testIdPrefix}-tab-${t.key}`}
            >
              {Icon && <Icon className="w-4 h-4 shrink-0 opacity-80" />}
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-7">
        {typeof children === "function" ? children(tab) : children}
      </div>
    </div>
  );
}
