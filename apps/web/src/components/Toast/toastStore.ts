/**
 * Phase F — tiny global toast store.
 *
 * Lives outside the Zustand store on purpose: toasts are pure UI
 * ephemera (no persistence, no session scope), and a self-contained
 * pub/sub means non-React modules (`runTurn.ts`, error handlers) can
 * raise a toast without re-plumbing the store.
 *
 * Usage:
 *   import { toast } from "@/components/Toast/toastStore";
 *   toast.success("Session saved");
 *   toast.error("Network unreachable", { actionLabel: "Retry", onAction: refetch });
 */

export type ToastKind = "info" | "success" | "warn" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Default 5_000ms; pass null to require manual dismissal. */
  durationMs?: number | null;
  actionLabel?: string;
  onAction?: () => void;
}

export type ToastInput = Omit<Toast, "id" | "kind"> | string;

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function nextId(): string {
  return `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emit(): void {
  listeners.forEach((listener) => listener(toasts));
}

function push(kind: ToastKind, input: ToastInput): string {
  const partial = typeof input === "string" ? { title: input } : input;
  const id = nextId();
  const next: Toast = { id, kind, ...partial };
  toasts = [...toasts, next];
  emit();
  // `durationMs: null` means "sticky — never auto-dismiss". An
  // omitted (undefined) value falls back to the default 5_000ms.
  const duration =
    partial.durationMs === undefined ? 5_000 : partial.durationMs;
  if (duration !== null && Number.isFinite(duration) && duration > 0) {
    setTimeout(() => dismiss(id), duration);
  }
  return id;
}

export function dismiss(id: string): void {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export function clearToasts(): void {
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}

export const toast = {
  info: (input: ToastInput) => push("info", input),
  success: (input: ToastInput) => push("success", input),
  warn: (input: ToastInput) => push("warn", input),
  error: (input: ToastInput) => push("error", input),
  dismiss,
  clear: clearToasts,
};

/** Test helper. */
export function __getToastsForTests(): readonly Toast[] {
  return toasts;
}
