/**
 * Phase F — one-time onboarding hint.
 *
 * Mounted at the bottom-right of the app shell on first run; once
 * dismissed (or once `prefs.onboardingDismissed` is set elsewhere)
 * it never reappears. The four bullets call out the headline
 * features so a new user knows where to start instead of staring
 * at an empty transcript.
 */

import { useEffect, useState } from "react";

import { usePrefs, writePrefs } from "../../lib/userPreferences";

export function OnboardingHint() {
  const prefs = usePrefs();
  // Defer rendering by one tick to avoid a flash on initial mount
  // where prefs may briefly be the in-memory default before the
  // localStorage value is read.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  if (!ready || prefs.onboardingDismissed) return null;
  return (
    <aside
      role="dialog"
      aria-labelledby="onboarding-title"
      className="card fixed bottom-4 right-4 z-30 w-[min(360px,calc(100vw-2rem))] p-4 text-sm shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="onboarding-title"
            className="font-serif text-lg text-fg"
          >
            Welcome to Seneca
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
            <li>
              Hold <kbd className="rounded border border-border bg-card px-1 text-[11px] text-fg">Space</kbd>{" "}
              to talk, release to send.
            </li>
            <li>
              Tap the eye to let Seneca see your active tab — lock it for an
              ongoing study session.
            </li>
            <li>
              Drop a PDF or paste a URL into the canvas tabs to ground the
              conversation.
            </li>
            <li>
              Press{" "}
              <kbd className="rounded border border-border bg-card px-1 text-[11px] text-fg">
                ⌘
              </kbd>
              <kbd className="ml-0.5 rounded border border-border bg-card px-1 text-[11px] text-fg">
                /
              </kbd>{" "}
              any time for the full shortcut list.
            </li>
          </ul>
        </div>
        <button
          type="button"
          onClick={() => writePrefs({ onboardingDismissed: true })}
          aria-label="Dismiss welcome message"
          className="shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-sunk hover:text-fg"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="btn-primary px-3 py-1 text-xs"
          onClick={() => writePrefs({ onboardingDismissed: true })}
        >
          Got it
        </button>
      </div>
    </aside>
  );
}
