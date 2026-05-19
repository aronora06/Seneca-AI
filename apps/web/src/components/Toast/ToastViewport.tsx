/**
 * Phase F — toast viewport.
 *
 * Renders pending toasts in a fixed, top-right column. Each toast
 * fades in, sits for `durationMs`, then fades out. The dismiss
 * button on the right gives the user a way to clear stuck toasts
 * (e.g. when `durationMs: null`).
 *
 * Accessibility: the viewport is `role="status"` + `aria-live="polite"`
 * so screen readers announce new toasts without stealing focus.
 */

import { useEffect, useState } from "react";

import { dismiss, subscribeToasts, type Toast, type ToastKind } from "./toastStore";

const KIND_STYLES: Record<ToastKind, { ring: string; icon: string; iconColor: string }> = {
  info: {
    ring: "border-border bg-card",
    icon: "i",
    iconColor: "text-fg-muted",
  },
  success: {
    ring: "border-ok/40 bg-ok-soft",
    icon: "✓",
    iconColor: "text-ok",
  },
  warn: {
    ring: "border-accent/60 bg-accent/10",
    icon: "!",
    iconColor: "text-accent",
  },
  error: {
    ring: "border-danger/50 bg-danger-soft",
    icon: "!",
    iconColor: "text-danger",
  },
};

export function ToastViewport() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const styles = KIND_STYLES[toast.kind];
  return (
    <div
      role="status"
      aria-live={toast.kind === "error" ? "assertive" : "polite"}
      className={`pointer-events-auto card toast-enter flex items-start gap-3 border ${styles.ring} px-3 py-2 text-sm shadow-soft`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current/30 font-semibold ${styles.iconColor}`}
      >
        {styles.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">{toast.title}</div>
        {toast.description ? (
          <div className="mt-0.5 text-xs text-fg-muted">
            {toast.description}
          </div>
        ) : null}
        {toast.actionLabel && toast.onAction ? (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              dismiss(toast.id);
            }}
            className="mt-1.5 text-xs font-medium text-accent hover:underline"
          >
            {toast.actionLabel}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-surface-sunk hover:text-fg"
      >
        <span aria-hidden>×</span>
      </button>
    </div>
  );
}
