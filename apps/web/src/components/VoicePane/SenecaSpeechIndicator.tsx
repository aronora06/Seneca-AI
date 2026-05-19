import clsx from "clsx";

import { BarSpectrumCanvas } from "./BarSpectrumCanvas";

interface Props {
  active: boolean;
  fancy: boolean;
  /** When true, tap the ElevenLabs audio element; else procedural shimmer. */
  playbackReactive: boolean;
  className?: string;
}

/**
 * Seneca-zone indicator — flows from the left (transcript side).
 */
export function SenecaSpeechIndicator({
  active,
  fancy,
  playbackReactive,
  className,
}: Props) {
  if (!active) return null;

  if (!fancy) {
    return (
      <span
        className={clsx(
          "inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent",
          className,
        )}
        title="Speaking"
        aria-hidden
      />
    );
  }

  return (
    <div
      className={clsx("flex items-center gap-1", className)}
      title="Seneca is speaking"
    >
      <div
        className="rounded-r-md bg-gradient-to-r from-accent/20 to-transparent py-0.5 pl-0.5 pr-1"
        aria-hidden
      >
        <BarSpectrumCanvas
          active
          source={playbackReactive ? "playback" : "procedural"}
          width={48}
          height={18}
          bars={5}
          colorVar="--c-accent"
          colorFallback="212 154 71"
          anchor="center"
        />
      </div>
    </div>
  );
}
