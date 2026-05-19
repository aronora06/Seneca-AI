/**
 * Shared canvas bar-spectrum drawing for mic + playback waveforms.
 */

export function getThemeRgb(
  varName: string,
  fallback: string,
): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return raw.length > 0 ? raw : fallback;
}

export function roundRect(
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

export interface DrawBarSpectrumOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  bars: number;
  bins: Uint8Array<ArrayBuffer>;
  binsReady: boolean;
  smoothBuf: Float32Array;
  rgb: string;
  /** 0 = centered bars, 1 = grow from bottom (user rail) */
  anchor: "center" | "bottom";
  minOpacity?: number;
}

export function drawBarSpectrum(opts: DrawBarSpectrumOptions): void {
  const {
    ctx,
    width,
    height,
    bars,
    bins,
    binsReady,
    smoothBuf,
    rgb,
    anchor,
    minOpacity = 0.35,
  } = opts;

  ctx.clearRect(0, 0, width, height);

  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (bars + 1)) / bars);
  const totalBins = bins.length;

  for (let i = 0; i < bars; i++) {
    const t = i / Math.max(1, bars - 1);
    const idx = Math.min(
      totalBins - 1,
      Math.floor(Math.pow(t, 1.7) * totalBins),
    );
    const raw = totalBins > 0 && binsReady ? (bins[idx] ?? 0) / 255 : 0;

    const prev = smoothBuf[i]!;
    const target = binsReady ? raw : 0;
    const eased = prev + (target - prev) * 0.45;
    smoothBuf[i] = eased < 0.001 ? 0 : eased;

    const barHeight = Math.max(2, eased * height);
    const x = gap + i * (barWidth + gap);
    const y =
      anchor === "bottom" ? height - barHeight : (height - barHeight) / 2;
    ctx.fillStyle = `rgba(${rgb} / ${Math.max(minOpacity, eased)})`;
    roundRect(ctx, x, y, barWidth, barHeight, Math.min(2, barWidth / 2));
    ctx.fill();
  }
}

/** Procedural fallback when browser TTS has no audio element to analyse. */
export function drawProceduralBars(opts: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  bars: number;
  smoothBuf: Float32Array;
  rgb: string;
  anchor: "center" | "bottom";
  tick: number;
}): void {
  const { ctx, width, height, bars, smoothBuf, rgb, anchor, tick } = opts;
  ctx.clearRect(0, 0, width, height);
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (bars + 1)) / bars);

  for (let i = 0; i < bars; i++) {
    const wave =
      0.35 +
      0.25 * Math.sin(tick * 0.12 + i * 0.9) +
      0.15 * Math.sin(tick * 0.07 + i * 1.4);
    const prev = smoothBuf[i]!;
    const eased = prev + (wave - prev) * 0.2;
    smoothBuf[i] = eased;

    const barHeight = Math.max(2, eased * height);
    const x = gap + i * (barWidth + gap);
    const y =
      anchor === "bottom" ? height - barHeight : (height - barHeight) / 2;
    ctx.fillStyle = `rgba(${rgb} / ${Math.max(0.35, eased)})`;
    roundRect(ctx, x, y, barWidth, barHeight, Math.min(2, barWidth / 2));
    ctx.fill();
  }
}
