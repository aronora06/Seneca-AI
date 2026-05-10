import clsx from "clsx";
import { useSenecaStore } from "../../store/seneca";

export function VisionToggle() {
  const enabled = useSenecaStore((s) => s.vision.enabled);
  const pinned = useSenecaStore((s) => s.vision.pinned);
  const toggleArmed = useSenecaStore((s) => s.toggleVisionArmed);
  const togglePinned = useSenecaStore((s) => s.toggleVisionPinned);

  const state: "off" | "armed" | "pinned" = pinned
    ? "pinned"
    : enabled
      ? "armed"
      : "off";

  const label = {
    off: "Vision is off. Click to let Seneca see the canvas on your next message.",
    armed:
      "Vision will be sent on your next message, then automatically turn off. Shift-click to pin.",
    pinned: "Vision is pinned on. Click to turn it off.",
  }[state];

  return (
    <button
      type="button"
      onClick={(e) => {
        if (e.shiftKey) togglePinned();
        else toggleArmed();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        togglePinned();
      }}
      title={label}
      aria-label={label}
      className={clsx(
        "btn h-9 w-9 !p-0 ring-1 transition-all",
        state === "off" &&
          "bg-surface-sunk text-fg-subtle ring-border hover:text-fg",
        state === "armed" &&
          "bg-accent/20 text-accent ring-accent/60 hover:bg-accent/30",
        state === "pinned" &&
          "bg-accent text-accent-fg ring-accent hover:opacity-90",
      )}
    >
      <EyeIcon variant={state === "off" ? "outline" : "solid"} />
    </button>
  );
}

function EyeIcon({ variant }: { variant: "solid" | "outline" }) {
  if (variant === "solid") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 5c-7.6 0-11 7-11 7s3.4 7 11 7 11-7 11-7-3.4-7-11-7zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" />
        <circle cx="12" cy="12" r="2.5" fill="rgb(var(--c-card))" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
