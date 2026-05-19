/**
 * Phase A — three-state segmented control for the vision toggle.
 *
 * Before this change the only way to keep vision on across multiple
 * messages was a shift-click "pin" on a single eye button. Nothing in
 * the UI surfaced that. The segmented control replaces it with three
 * discoverable states:
 *
 *  - Off    — Seneca does not see the canvas.
 *  - Once   — Seneca sees the active tab on your next message, then the
 *             toggle reverts to Off (the existing "armed" behaviour).
 *  - Locked — Seneca sees the active tab on every message until you
 *             switch it back to Off (the existing "pinned" behaviour).
 *
 * Keyboard navigation follows the WAI-ARIA radio-group pattern:
 * ArrowLeft / ArrowRight (and Up / Down) cycle between segments, Home
 * jumps to the first segment, End to the last. Selecting a segment via
 * Space / Enter or click commits it through `setVisionMode`.
 */
import clsx from "clsx";
import { useCallback, useRef } from "react";

import { useSenecaStore, visionModeFor, type VisionMode } from "../../store/seneca";

interface SegmentDef {
  mode: VisionMode;
  label: string;
  helperText: string;
}

const SEGMENTS: SegmentDef[] = [
  {
    mode: "off",
    label: "Off",
    helperText: "Seneca cannot see the canvas. Click to turn vision on.",
  },
  {
    mode: "once",
    label: "",
    helperText:
      "Seneca sees the canvas on your next message only, then turns vision off.",
  },
  {
    mode: "locked",
    label: "",
    helperText:
      "Seneca sees the canvas on every message until you switch vision off.",
  },
];

export function VisionToggle() {
  const enabled = useSenecaStore((s) => s.vision.enabled);
  const pinned = useSenecaStore((s) => s.vision.pinned);
  const setVisionMode = useSenecaStore((s) => s.setVisionMode);

  const mode = visionModeFor({ enabled, pinned });

  const containerRef = useRef<HTMLDivElement>(null);

  const focusSegment = useCallback((next: VisionMode) => {
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLButtonElement>(
      `[data-vision-mode="${next}"]`,
    );
    target?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const currentIndex = SEGMENTS.findIndex((s) => s.mode === mode);
      let nextIndex = currentIndex;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = (currentIndex + 1) % SEGMENTS.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = (currentIndex - 1 + SEGMENTS.length) % SEGMENTS.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = SEGMENTS.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      const nextMode = SEGMENTS[nextIndex]!.mode;
      setVisionMode(nextMode);
      focusSegment(nextMode);
    },
    [mode, setVisionMode, focusSegment],
  );

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Vision (let Seneca see the canvas)"
      className="flex items-center gap-0.5 rounded-full border border-border bg-surface-sunk/70 p-0.5"
    >
      {SEGMENTS.map((seg) => {
        const active = seg.mode === mode;
        return (
          <button
            key={seg.mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`Vision ${seg.label.toLowerCase()}: ${seg.helperText}`}
            title={seg.helperText}
            tabIndex={active ? 0 : -1}
            data-vision-mode={seg.mode}
            onClick={() => setVisionMode(seg.mode)}
            onKeyDown={handleKeyDown}
            className={clsx(
              "flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              active
                ? "bg-accent text-accent-fg shadow-sm"
                : "text-fg-muted hover:bg-surface-sunk hover:text-fg",
            )}
          >
            <SegmentIcon mode={seg.mode} active={active} />
            <span>{seg.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SegmentIcon({ mode, active }: { mode: VisionMode; active: boolean }) {
  if (mode === "off") {
    return <EyeOutline />;
  }
  return (
    <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center">
      <EyeSolid />
      {mode === "once" && (
        <span
          aria-hidden
          className={clsx(
            "absolute -bottom-1.5 -right-1.5 inline-flex h-3 min-w-[0.75rem] items-center justify-center rounded-full px-0.5 text-[8px] font-semibold leading-none ring-1",
            active
              ? "bg-card text-fg ring-accent/60"
              : "bg-card text-fg-muted ring-border",
          )}
        >
          1×
        </span>
      )}
      {mode === "locked" && (
        <LockBadge active={active} />
      )}
    </span>
  );
}

function EyeOutline() {
  return (
    <svg
      width="14"
      height="14"
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

function EyeSolid() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 5c-7.6 0-11 7-11 7s3.4 7 11 7 11-7 11-7-3.4-7-11-7zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" />
      <circle cx="12" cy="12" r="2.5" fill="rgb(var(--c-card))" />
    </svg>
  );
}

function LockBadge({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "absolute -bottom-1.5 -right-1.5 inline-flex h-3 w-3 items-center justify-center rounded-full ring-1",
        active ? "bg-card ring-accent/60" : "bg-card ring-border",
      )}
    >
      <svg
        width="7"
        height="7"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={active ? "text-fg" : "text-fg-muted"}
      >
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  );
}
