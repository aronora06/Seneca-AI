import clsx from "clsx";

import type { VoiceActivityPhase } from "../../hooks/useVoiceActivity";

interface Props {
  phase: VoiceActivityPhase;
  fancy: boolean;
  label: string | null;
  className?: string;
}

const WORKING: VoiceActivityPhase[] = [
  "senecaThinking",
  "senecaStreaming",
  "senecaTooling",
];

export function SenecaActivityBeacon({ phase, fancy, label, className }: Props) {
  const working = WORKING.includes(phase);
  if (!working || !label) return null;

  if (!fancy) {
    return (
      <div
        className={clsx(
          "flex items-center gap-2 px-4 py-1 text-[10px] uppercase tracking-wider text-fg-subtle",
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-fg-subtle/60" />
        {label}
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "relative mx-3 mt-2 flex items-center gap-2 overflow-hidden rounded-md border border-border/60 bg-surface-sunk/40 px-3 py-1.5",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className="absolute inset-y-0 left-0 w-0.5 bg-accent/70"
        aria-hidden
      />
      <span className="flex items-center gap-0.5 pl-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={clsx(
              "h-1 w-1 rounded-full bg-accent/80",
              phase === "senecaTooling" && i === 1 && "bg-ok/80",
              "animate-pulse",
            )}
            style={{ animationDelay: `${i * 180}ms` }}
          />
        ))}
      </span>
      <span className="text-[11px] font-medium text-fg-muted">{label}</span>
    </div>
  );
}
