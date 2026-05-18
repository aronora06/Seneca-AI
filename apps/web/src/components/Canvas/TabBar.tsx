import clsx from "clsx";
import { useEffect } from "react";
import {
  useSenecaStore,
  visionModeFor,
  type ActiveTab,
} from "../../store/seneca";

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
  const visionEnabled = useSenecaStore((s) => s.vision.enabled);
  const visionPinned = useSenecaStore((s) => s.vision.pinned);
  const setActiveTab = useSenecaStore((s) => s.setActiveTab);
  const clearTabPulse = useSenecaStore((s) => s.clearTabPulse);

  const visionMode = visionModeFor({
    enabled: visionEnabled,
    pinned: visionPinned,
  });

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
      {TABS.map((t) => {
        const isActive = activeTab === t.id;
        const showVisionBadge = isActive && visionMode !== "off";
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            disabled={t.disabled}
            onClick={() => !t.disabled && setActiveTab(t.id)}
            title={t.hint ?? undefined}
            className={clsx(
              "btn relative h-8 px-3 text-xs font-medium",
              isActive
                ? "bg-fg text-fg-on"
                : t.disabled
                  ? "cursor-not-allowed text-fg-subtle/70"
                  : "text-fg-muted hover:bg-surface-sunk hover:text-fg",
              pulseTarget === t.id && "tab-pulse",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.label}
              {t.hint && (
                <span className="text-[10px] font-normal opacity-60">
                  {t.hint}
                </span>
              )}
              {showVisionBadge && <VisionActiveBadge mode={visionMode} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Small inline indicator that surfaces the live vision state on the
 * active tab — so the user can see at a glance whether Seneca will see
 * the canvas on their next message. Only renders when vision is on.
 */
function VisionActiveBadge({ mode }: { mode: "once" | "locked" }) {
  const tooltip =
    mode === "locked"
      ? "Seneca will see this tab on every message until you turn vision off."
      : "Seneca will see this tab on your next message, then vision turns off.";
  return (
    <span
      aria-label={tooltip}
      title={tooltip}
      className="inline-flex items-center gap-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-fg"
    >
      <EyeGlyph />
      <span>{mode === "locked" ? "Locked" : "1×"}</span>
    </span>
  );
}

function EyeGlyph() {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 5c-7.6 0-11 7-11 7s3.4 7 11 7 11-7 11-7-3.4-7-11-7zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" />
    </svg>
  );
}
