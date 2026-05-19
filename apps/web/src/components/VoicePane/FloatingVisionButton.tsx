import clsx from "clsx";

import {
  useSenecaStore,
  visionModeFor,
  type VisionMode,
} from "../../store/seneca";

const CYCLE: VisionMode[] = ["off", "once", "locked"];

const LABELS: Record<VisionMode, string> = {
  off: "Vision off",
  once: "Vision once",
  locked: "Vision locked",
};

const GLYPHS: Record<VisionMode, string> = {
  off: "◎",
  once: "◉",
  locked: "⦿",
};

export function FloatingVisionButton() {
  const enabled = useSenecaStore((s) => s.vision.enabled);
  const pinned = useSenecaStore((s) => s.vision.pinned);
  const setVisionMode = useSenecaStore((s) => s.setVisionMode);
  const mode = visionModeFor({ enabled, pinned });

  const cycle = () => {
    const i = CYCLE.indexOf(mode);
    const next = CYCLE[(i + 1) % CYCLE.length]!;
    setVisionMode(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={LABELS[mode]}
      aria-label={LABELS[mode]}
      aria-pressed={mode !== "off"}
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors",
        mode !== "off"
          ? "bg-accent/20 text-accent ring-1 ring-accent/40"
          : "text-fg-muted hover:bg-surface-sunk hover:text-fg",
      )}
    >
      <span aria-hidden>{GLYPHS[mode]}</span>
    </button>
  );
}
