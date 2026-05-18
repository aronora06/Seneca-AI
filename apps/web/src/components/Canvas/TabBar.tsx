import clsx from "clsx";
import { useEffect } from "react";
import { useSenecaStore, type ActiveTab } from "../../store/seneca";

const TABS: Array<{
  id: ActiveTab;
  label: string;
  disabled?: boolean;
  hint?: string;
}> = [
  { id: "whiteboard", label: "Whiteboard" },
  { id: "map", label: "Map" },
  { id: "web", label: "Web" },
  { id: "documents", label: "Documents" },
];

export function TabBar() {
  const activeTab = useSenecaStore((s) => s.activeTab);
  const pulseTarget = useSenecaStore((s) => s.tabPulseTarget);
  const setActiveTab = useSenecaStore((s) => s.setActiveTab);
  const clearTabPulse = useSenecaStore((s) => s.clearTabPulse);

  useEffect(() => {
    if (!pulseTarget) return;
    const t = window.setTimeout(clearTabPulse, 2800);
    return () => window.clearTimeout(t);
  }, [pulseTarget, clearTabPulse]);

  return (
    <div
      role="tablist"
      className="flex items-center gap-1 border-b border-border bg-card/50 px-3 py-1.5 backdrop-blur"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={activeTab === t.id}
          disabled={t.disabled}
          onClick={() => !t.disabled && setActiveTab(t.id)}
          title={t.hint ?? undefined}
          className={clsx(
            "btn h-8 px-3 text-xs font-medium",
            activeTab === t.id
              ? "bg-fg text-fg-on"
              : t.disabled
                ? "cursor-not-allowed text-fg-subtle/70"
                : "text-fg-muted hover:bg-surface-sunk hover:text-fg",
            pulseTarget === t.id && "tab-pulse",
          )}
        >
          {t.label}
          {t.hint && (
            <span className="ml-1.5 text-[10px] font-normal opacity-60">
              {t.hint}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
