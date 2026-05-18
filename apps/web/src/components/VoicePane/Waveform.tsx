/**
 * Phase B — a compact, GPU-cheap audio level indicator.
 *
 * Renders a small canvas-based bar chart fed by the live microphone
 * analyser so the user can see their voice is being heard. Lives next
 * to the push-to-talk button.
 *
 * Drawing discipline:
 *  - Single requestAnimationFrame loop while `active` is true.
 *  - Reads frequency bins through `useMicAnalyser`, picks `BAR_COUNT`
 *    evenly-spaced bins, and paints them with a small ease-in falloff
 *    so silence settles smoothly rather than snapping flat.
 *  - Cleans up the rAF handle and clears the canvas on every state
 *    change so a paused waveform doesn't keep the CPU awake.
 *
 * Theme: bars use the current accent token via
 * `getComputedStyle(document.documentElement).getPropertyValue('--c-accent')`
 * so they follow the user's chosen accent without hardcoding a hex.
 * SSR / test fallback is a sensible neutral grey.
 */
import { useEffect, useMemo, useRef } from "react";

import { useMicAnalyser } from "../../hooks/useMicAnalyser";

interface Props {
  /** Render and pull mic data only while this is true. */
  active: boolean;
  /** Width in CSS pixels. Defaults to 56. */
  width?: number;
  /** Height in CSS pixels. Defaults to 18. */
  height?: number;
  /** Number of bars. Defaults to 7. */
  bars?: number;
  /** Class applied to the container so callers can place / size it. */
  className?: string;
}

const DEFAULT_ACCENT_RGB = "180 96 80"; // ember-ish; matches the default theme

export function Waveform({
  active,
  width = 56,
  height = 18,
  bars = 7,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackBuf = useMemo(() => new Float32Array(bars), [bars]);
  const analyser = useMicAnalyser({ active });

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Reset smoothed values so bars rise from 0 on mount.
    for (let i = 0; i < fallbackBuf.length; i++) fallbackBuf[i] = 0;

    let rafId = 0;
    let bins: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));

    const accent = getAccentRgb();

    const draw = () => {
      if (analyser.ready) {
        bins = analyser.getFrequencyBins(bins);
      }
      ctx.clearRect(0, 0, width, height);

      const gap = 2;
      const barWidth = Math.max(2, (width - gap * (bars + 1)) / bars);
      const totalBins = bins.length;

      for (let i = 0; i < bars; i++) {
        // Sample logarithmically so low-frequency speech (which is
        // where most voice energy lives) gets more visual weight.
        const t = i / Math.max(1, bars - 1);
        const idx = Math.min(
          totalBins - 1,
          Math.floor(Math.pow(t, 1.7) * totalBins),
        );
        const raw = totalBins > 0 ? (bins[idx] ?? 0) / 255 : 0;

        // Ease toward the new target so bars don't twitch frame-to-
        // frame. The decay term ensures we settle to 0 in silence.
        const prev = fallbackBuf[i]!;
        const target = analyser.ready ? raw : 0;
        const eased = prev + (target - prev) * 0.45;
        fallbackBuf[i] = eased < 0.001 ? 0 : eased;

        const barHeight = Math.max(2, eased * height);
        const x = gap + i * (barWidth + gap);
        const y = (height - barHeight) / 2;
        ctx.fillStyle = `rgba(${accent} / ${Math.max(0.35, eased)})`;
        roundRect(ctx, x, y, barWidth, barHeight, Math.min(2, barWidth / 2));
        ctx.fill();
      }

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(rafId);
      ctx.clearRect(0, 0, width, height);
    };
  }, [active, analyser, width, height, bars, fallbackBuf]);

  if (!active) return null;

  return (
    <span
      aria-hidden
      title={
        analyser.error
          ? analyser.error
          : analyser.ready
            ? "Microphone is hearing you"
            : "Opening microphone…"
      }
      className={className}
    >
      <canvas ref={canvasRef} />
    </span>
  );
}

function getAccentRgb(): string {
  if (typeof document === "undefined") return DEFAULT_ACCENT_RGB;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--c-accent")
    .trim();
  return raw.length > 0 ? raw : DEFAULT_ACCENT_RGB;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
