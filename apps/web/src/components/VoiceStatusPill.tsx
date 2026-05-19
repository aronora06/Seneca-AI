/**
 * Header pill — live voice activity (listening / speaking / working).
 *
 * Mobile: colored dot + screen-reader label only.
 * sm+: dot + human-readable label (matches CostPill styling).
 */

import clsx from "clsx";

import type { VoiceActivityPhase } from "../hooks/useVoiceActivity";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { useSenecaStore } from "../store/seneca";

function dotClass(phase: VoiceActivityPhase): string {
  switch (phase) {
    case "userListening":
    case "userDictating":
      return "bg-danger";
    case "senecaSpeaking":
      return "bg-accent";
    case "senecaStreaming":
    case "senecaTooling":
    case "senecaThinking":
      return "bg-fg-subtle/70";
    default:
      return "bg-fg-subtle/50";
  }
}

export function VoiceStatusPill() {
  const phase = useSenecaStore((s) => s.voice.activityPhase);
  const label = useSenecaStore((s) => s.voice.activityLabel);
  const reducedMotion = useReducedMotion();

  if (phase === "idle" || !label) return null;

  const pulse = !reducedMotion && phase !== "senecaSpeaking";

  return (
    <span
      title={label}
      role="status"
      aria-live="polite"
      aria-label={label}
      className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-[10px] text-fg-muted"
    >
      <span
        aria-hidden
        className={clsx(
          "h-2 w-2 shrink-0 rounded-full",
          dotClass(phase),
          pulse && "animate-pulse",
        )}
      />
      <span className="hidden sm:inline" aria-hidden>
        {label}
      </span>
    </span>
  );
}
