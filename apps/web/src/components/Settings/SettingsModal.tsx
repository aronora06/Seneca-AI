import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

import { AppearancePanel } from "./panels/AppearancePanel";
import { VoicePanel } from "./panels/VoicePanel";
import { CustomInstructionsPanel } from "./panels/CustomInstructionsPanel";
import { ProfilePanel } from "./panels/ProfilePanel";
import { ShortcutsPanel } from "./panels/ShortcutsPanel";
import { MemoryPanel } from "./panels/MemoryPanel";
import { UsageBillingPanel } from "./panels/UsageBillingPanel";
import { DataPrivacyPanel } from "./panels/DataPrivacyPanel";
import { AboutPanel } from "./panels/AboutPanel";

export type SettingsTab =
  | "profile"
  | "appearance"
  | "voice"
  | "instructions"
  | "memory"
  | "usage"
  | "privacy"
  | "shortcuts"
  | "about";

interface TabDef {
  id: SettingsTab;
  label: string;
  group: "user" | "system" | "info";
}

const TABS: TabDef[] = [
  { id: "profile",      label: "Profile",            group: "user" },
  { id: "instructions", label: "Custom Instructions", group: "user" },
  { id: "memory",       label: "Memory",             group: "user" },
  { id: "appearance",   label: "Appearance",         group: "system" },
  { id: "voice",        label: "Voice & Audio",      group: "system" },
  { id: "usage",        label: "Usage & Billing",    group: "system" },
  { id: "privacy",      label: "Data & Privacy",     group: "system" },
  { id: "shortcuts",    label: "Shortcuts",          group: "info" },
  { id: "about",        label: "About",              group: "info" },
];

const GROUP_LABELS: Record<TabDef["group"], string> = {
  user: "Personalization",
  system: "Application",
  info: "Help",
};

const PANELS: Record<SettingsTab, React.ComponentType> = {
  profile: ProfilePanel,
  instructions: CustomInstructionsPanel,
  memory: MemoryPanel,
  appearance: AppearancePanel,
  voice: VoicePanel,
  usage: UsageBillingPanel,
  privacy: DataPrivacyPanel,
  shortcuts: ShortcutsPanel,
  about: AboutPanel,
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tab to show when the modal opens. Defaults to "profile". */
  initialTab?: SettingsTab;
}

export function SettingsModal({ open, onClose, initialTab = "profile" }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset to the requested initial tab whenever the modal opens.
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const ActivePanel = PANELS[activeTab];
  const groups = groupTabs(TABS);

  // Render via portal so the modal escapes the header's backdrop-filter,
  // which would otherwise turn position:fixed into position:absolute and
  // clip the modal to the header's box.
  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-fg/30 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="flex h-[min(88vh,720px)] w-[min(92vw,860px)] overflow-hidden rounded-xl border border-border bg-card shadow-soft dark:shadow-soft-dark">
        {/* Sidebar */}
        <nav className="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-surface-sunk/50 py-4">
          <h2 className="px-4 font-serif text-sm tracking-wide text-fg-muted">
            Settings
          </h2>
          {groups.map(([group, tabs]) => (
            <div key={group} className="flex flex-col">
              <div className="mb-1 px-4 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                {GROUP_LABELS[group]}
              </div>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    "mx-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                    activeTab === tab.id
                      ? "bg-accent/15 font-medium text-fg"
                      : "text-fg-muted hover:bg-surface-sunk hover:text-fg",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <h3 className="font-serif text-lg text-fg">
              {TABS.find((t) => t.id === activeTab)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost h-8 w-8 !p-0 text-lg"
              aria-label="Close settings"
            >
              &times;
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <ActivePanel />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function groupTabs(tabs: TabDef[]): Array<[TabDef["group"], TabDef[]]> {
  const map = new Map<TabDef["group"], TabDef[]>();
  for (const t of tabs) {
    const arr = map.get(t.group) ?? [];
    arr.push(t);
    map.set(t.group, arr);
  }
  return [...map.entries()];
}
