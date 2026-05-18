import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

import { useAuth } from "../../auth/AuthProvider";
import { usePrefs } from "../../lib/userPreferences";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { SettingsModal, type SettingsTab } from "./SettingsModal";

/** Deterministic avatar background derived from a string hash → HSL. */
function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 40%, 45%)`;
}

function displayInitial(name: string, email: string | null): string {
  return (name || email || "?").charAt(0).toUpperCase();
}

function displayLabel(name: string, email: string | null): string {
  return name || email || "User";
}

export function ProfileMenu() {
  const { user, signOut, bypass } = useAuth();
  const prefs = usePrefs();

  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialTab, setInitialTab] = useState<SettingsTab>("profile");
  const menuRef = useRef<HTMLDivElement>(null);

  const name = prefs.displayName;
  const email = user?.email ?? null;
  const initial = displayInitial(name, email);
  const label = displayLabel(name, email);
  const bg = avatarColor(user?.id ?? "default");

  const openSettings = useCallback((tab: SettingsTab) => {
    setOpen(false);
    setInitialTab(tab);
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full px-1.5 py-1 text-sm text-fg-muted transition-colors hover:bg-surface-sunk hover:text-fg"
          aria-label="User menu"
          aria-expanded={open}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: bg }}
          >
            {initial}
          </span>
          <span className="hidden text-xs sm:inline">{label}</span>
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-border bg-card shadow-soft dark:shadow-soft-dark">
            <div className="border-b border-border px-3 py-2.5">
              <p className="text-sm font-medium text-fg">{label}</p>
              {email && (
                <p className="mt-0.5 truncate text-xs text-fg-subtle">{email}</p>
              )}
            </div>

            <div className="border-b border-border px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-muted">Theme</span>
                <ThemeToggle />
              </div>
            </div>

            <MenuGroup>
              <MenuItem label="Settings"            onClick={() => openSettings("profile")} />
              <MenuItem label="Custom Instructions" onClick={() => openSettings("instructions")} />
              <MenuItem label="Memory"              onClick={() => openSettings("memory")} />
              <MenuItem label="Usage & Billing"     onClick={() => openSettings("usage")} />
            </MenuGroup>

            <MenuGroup>
              <MenuItem label="Help & Shortcuts"    onClick={() => openSettings("shortcuts")} />
              <MenuItem label="About Seneca"        onClick={() => openSettings("about")} />
            </MenuGroup>

            {!bypass && (
              <MenuGroup>
                <MenuItem
                  label="Sign out"
                  danger
                  onClick={() => {
                    setOpen(false);
                    void signOut();
                  }}
                />
              </MenuGroup>
            )}
          </div>
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={initialTab}
      />
    </>
  );
}

function MenuGroup({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-border py-1 last:border-b-0">{children}</div>;
}

function MenuItem(props: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={clsx(
        "flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors",
        props.danger
          ? "text-danger hover:bg-danger-soft"
          : "text-fg-muted hover:bg-surface-sunk hover:text-fg",
      )}
    >
      {props.label}
    </button>
  );
}
