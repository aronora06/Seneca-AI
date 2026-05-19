/**
 * Single-letter app-wide keyboard shortcuts that don't open a modal.
 *
 * Convention (mirrors the entries listed in ShortcutOverlay):
 *
 *   - Fire only when no editable element (input / textarea / select /
 *     contentEditable) is focused. This is what lets `C` be the
 *     Conversation Mode toggle without stealing the letter from
 *     anything the user is typing into.
 *   - No modifier keys required, no `event.preventDefault()` unless we
 *     actually handle the key. We want browser shortcuts to keep
 *     working.
 *   - One key per behaviour. Composability with modal shortcuts
 *     (Cmd/Ctrl+...) lives in the modal components themselves; this
 *     hook stays out of that lane.
 */

import { useEffect } from "react";

import { toast } from "../Toast/toastStore";
import { usePrefs, writePrefs } from "../../lib/userPreferences";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function GlobalShortcuts() {
  const prefs = usePrefs();
  // We don't strictly need the prefs value here (writePrefs reads the
  // latest itself), but pulling it via usePrefs keeps the toast text
  // honest if anything ever derives from it.
  void prefs;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Allow browser shortcuts and other modifier-based combos
      // (Cmd+K opens sessions, Cmd+/ opens the help overlay, etc.)
      // to pass through untouched.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat) return;
      if (isEditableTarget(event.target)) return;

      const key = event.key.toLowerCase();

      if (key === "c") {
        event.preventDefault();
        const next = !writePrefs({}).conversationMode;
        writePrefs({
          conversationMode: next,
          conversationModeHintDismissed: true,
        });
        toast.info({
          title: next ? "Conversation Mode is on" : "Conversation Mode is off",
          description: next
            ? "Talk whenever you want — Seneca will stop the moment you do."
            : undefined,
          durationMs: 2400,
        });
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
