import clsx from "clsx";

import type { VoiceActivityPhase } from "../../hooks/useVoiceActivity";
import { BarSpectrumCanvas } from "./BarSpectrumCanvas";

interface Props {
  phase: VoiceActivityPhase;
  fancy: boolean;
  dockSide: "left" | "right";
  playbackReactive: boolean;
}

/**
 * Vertical micro-indicators on the collapsed strip — user on outer edge,
 * Seneca on inner edge (toward canvas).
 */
export function CollapsedActivityIndicators({
  phase,
  fancy,
  dockSide,
  playbackReactive,
}: Props) {
  const userActive =
    phase === "userListening" || phase === "userDictating";
  const senecaSpeaking = phase === "senecaSpeaking";
  const senecaWorking =
    phase === "senecaThinking" ||
    phase === "senecaStreaming" ||
    phase === "senecaTooling";

  const userStack = (
    <CollapsedStack
      kind="user"
      active={userActive}
      fancy={fancy}
      label="You"
    />
  );
  const senecaStack = (
    <CollapsedStack
      kind="seneca"
      active={senecaSpeaking || senecaWorking}
      fancy={fancy}
      speaking={senecaSpeaking}
      playbackReactive={playbackReactive}
      label="Seneca"
    />
  );

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-3">
      {dockSide === "left" ? (
        <>
          {userStack}
          {senecaStack}
        </>
      ) : (
        <>
          {senecaStack}
          {userStack}
        </>
      )}
    </div>
  );
}

function CollapsedStack(props: {
  kind: "user" | "seneca";
  active: boolean;
  fancy: boolean;
  speaking?: boolean;
  playbackReactive?: boolean;
  label: string;
}) {
  if (!props.active) {
    return (
      <span
        className="h-1.5 w-1.5 rounded-full bg-border"
        title={`${props.label} idle`}
        aria-hidden
      />
    );
  }

  if (!props.fancy) {
    const color =
      props.kind === "user"
        ? "bg-danger"
        : props.speaking
          ? "bg-accent"
          : "bg-fg-subtle/60";
    return (
      <span
        className={clsx("h-2 w-2 animate-pulse rounded-full", color)}
        title={props.label}
        aria-hidden
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-0.5" title={props.label}>
      {props.kind === "user" ? (
        <BarSpectrumCanvas
          active
          source="mic"
          width={10}
          height={28}
          bars={4}
          colorVar="--c-danger"
          colorFallback="220 38 38"
          anchor="bottom"
        />
      ) : (
        <BarSpectrumCanvas
          active
          source={
            props.speaking && props.playbackReactive
              ? "playback"
              : "procedural"
          }
          width={10}
          height={28}
          bars={4}
          colorVar="--c-accent"
          colorFallback="212 154 71"
          anchor="bottom"
        />
      )}
    </div>
  );
}
