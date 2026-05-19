/**
 * One-time hint pointing at the new Conversation Mode button in the
 * floating dock. Shown the first time a user lands in the collapsed
 * pane with Conversation Mode off; dismissed forever the first time
 * they either toggle the mode on or click "Got it."
 *
 * Lives next to the dock via the same portal target, so it floats
 * over the canvas regardless of the pane's collapse state.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { WORKSPACE_STAGE_ID } from "../../hooks/useDraggablePosition";
import { usePrefs, writePrefs } from "../../lib/userPreferences";

export interface ConversationHintProps {
  /** Where the dock sits, so the hint can lean toward the controls. */
  dockSide: "left" | "right";
  /** Hide on screens that don't actually show the dock. */
  visible: boolean;
}

export function ConversationHint({ dockSide, visible }: ConversationHintProps) {
  const prefs = usePrefs();
  const [stage, setStage] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setStage(document.getElementById(WORKSPACE_STAGE_ID));
  }, []);

  // Don't show the hint if:
  //   - The dock isn't on screen.
  //   - The user already dismissed it (or already opted in).
  //   - Conversation Mode is currently on (the hint would be lying).
  if (!visible) return null;
  if (prefs.conversationModeHintDismissed) return null;
  if (prefs.conversationMode) return null;
  if (!stage) return null;

  const dismiss = () => {
    writePrefs({ conversationModeHintDismissed: true });
  };

  const onTry = () => {
    writePrefs({
      conversationMode: true,
      conversationModeHintDismissed: true,
    });
  };

  return createPortal(
    <div
      className="pointer-events-auto absolute bottom-4 z-40 max-w-[260px] rounded-xl border border-border bg-card/95 p-3 text-sm text-fg shadow-soft backdrop-blur-md dark:shadow-soft-dark"
      style={dockSide === "left" ? { left: 16 } : { right: 16 }}
      role="dialog"
      aria-label="Conversation Mode hint"
    >
      <div className="flex items-start gap-2">
        <span aria-hidden className="text-base leading-none">
          💬
        </span>
        <div className="flex-1">
          <div className="font-medium">Try Conversation Mode</div>
          <p className="mt-1 text-xs leading-snug text-fg-muted">
            Talk to Seneca hands-free. He listens while you speak and stops
            the moment you start talking again — no buttons to press.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onTry}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90"
            >
              Turn on
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-surface-sunk hover:text-fg"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>,
    stage,
  );
}
