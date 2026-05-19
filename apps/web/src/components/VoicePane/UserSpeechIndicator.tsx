import clsx from "clsx";

import { BarSpectrumCanvas } from "./BarSpectrumCanvas";

interface Props {
  active: boolean;
  fancy: boolean;
  className?: string;
}

/**
 * User-zone indicator — energy rises from the input rail (bottom-anchored).
 */
export function UserSpeechIndicator({ active, fancy, className }: Props) {
  if (!active) return null;

  if (!fancy) {
    return (
      <span
        className={clsx(
          "inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger",
          className,
        )}
        title="Listening"
        aria-hidden
      />
    );
  }

  return (
    <div
      className={clsx("flex flex-col items-end justify-end", className)}
      title="Microphone is hearing you"
    >
      <div
        className="rounded-t-md bg-gradient-to-t from-danger/15 to-transparent px-1 pt-1"
        aria-hidden
      >
        <BarSpectrumCanvas
          active
          source="mic"
          width={52}
          height={20}
          bars={6}
          colorVar="--c-danger"
          colorFallback="220 38 38"
          anchor="bottom"
        />
      </div>
    </div>
  );
}
