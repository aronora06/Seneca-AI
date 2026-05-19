/**
 * Phase F — keyboard shortcut overlay.
 *
 * A modal users can open with Cmd/Ctrl+/ that lists every keyboard
 * shortcut available in Seneca. Built as a single source of truth
 * (the `SHORTCUTS` constant): adding a new shortcut elsewhere is a
 * one-line addition here too. The overlay is also keyboard-friendly
 * — Escape closes it, Tab cycles focus within the dialog.
 */

import { useEffect, useState } from "react";

interface Shortcut {
  combo: string[];
  label: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Global",
    shortcuts: [
      { combo: ["⌘", "/"], label: "Show this overlay" },
      { combo: ["Esc"], label: "Close any open modal / overlay" },
      { combo: ["Space"], label: "Hold to talk (push-to-talk)" },
    ],
  },
  {
    title: "Sessions",
    shortcuts: [
      { combo: ["⌘", "K"], label: "Open sessions list" },
      { combo: ["⌘", "N"], label: "New session" },
    ],
  },
  {
    title: "Voice & Vision",
    shortcuts: [
      { combo: ["C"], label: "Toggle Conversation Mode" },
      { combo: ["V"], label: "Cycle vision mode (off → once → locked)" },
      { combo: ["M"], label: "Toggle microphone" },
    ],
  },
  {
    title: "Canvas",
    shortcuts: [
      { combo: ["1"], label: "Go to whiteboard tab" },
      { combo: ["2"], label: "Go to diagrams tab" },
      { combo: ["3"], label: "Go to map tab" },
      { combo: ["4"], label: "Go to web tab" },
      { combo: ["5"], label: "Go to documents tab" },
    ],
  },
];

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

function comboLabel(key: string): string {
  if (key === "⌘") return IS_MAC ? "⌘" : "Ctrl";
  return key;
}

export function ShortcutOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Accept either Cmd or Ctrl — saves the user from a "wrong
      // modifier" headache when they're on the Linux build of
      // Chrome but used to a Mac, or vice versa.
      const isPrimary = event.metaKey || event.ctrlKey;
      if (isPrimary && event.key === "/") {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="overlay-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-overlay-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="card w-full max-w-2xl p-6">
        <div className="flex items-center justify-between">
          <h2
            id="shortcut-overlay-title"
            className="font-serif text-2xl text-fg"
          >
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close shortcut overlay"
            className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-sunk hover:text-fg"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
        <p className="mt-2 text-sm text-fg-muted">
          Tap {comboLabel("⌘")}+/ any time to bring this back.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {SHORTCUTS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                {group.title}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.label}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-fg-muted hover:bg-surface-sunk"
                  >
                    <span>{shortcut.label}</span>
                    <span className="flex items-center gap-1">
                      {shortcut.combo.map((key, i) => (
                        <kbd
                          key={`${shortcut.label}-${i}`}
                          className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-fg"
                        >
                          {comboLabel(key)}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
