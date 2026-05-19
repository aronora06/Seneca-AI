import { useEffect, useMemo, useRef } from "react";

import {
  drawBarSpectrum,
  drawProceduralBars,
  getThemeRgb,
} from "../../lib/barSpectrum";
import { useMicAnalyser } from "../../hooks/useMicAnalyser";
import { usePlaybackAnalyser } from "../../hooks/usePlaybackAnalyser";

export type BarSpectrumSource = "mic" | "playback" | "procedural";

interface Props {
  active: boolean;
  source: BarSpectrumSource;
  width?: number;
  height?: number;
  bars?: number;
  colorVar?: string;
  colorFallback?: string;
  anchor?: "center" | "bottom";
  className?: string;
}

export function BarSpectrumCanvas({
  active,
  source,
  width = 56,
  height = 18,
  bars = 7,
  colorVar = "--c-accent",
  colorFallback = "180 96 80",
  anchor = "center",
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothBuf = useMemo(() => new Float32Array(bars), [bars]);
  const tickRef = useRef(0);

  const mic = useMicAnalyser({ active: active && source === "mic" });
  const playback = usePlaybackAnalyser({
    active: active && source === "playback",
  });

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (let i = 0; i < smoothBuf.length; i++) smoothBuf[i] = 0;

    let rafId = 0;
    let bins: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
    const rgb = getThemeRgb(colorVar, colorFallback);

    const draw = () => {
      tickRef.current += 1;
      if (source === "procedural") {
        drawProceduralBars({
          ctx,
          width,
          height,
          bars,
          smoothBuf,
          rgb,
          anchor,
          tick: tickRef.current,
        });
      } else {
        const analyser = source === "mic" ? mic : playback;
        if (analyser.ready) {
          bins = analyser.getFrequencyBins(bins);
        }
        drawBarSpectrum({
          ctx,
          width,
          height,
          bars,
          bins,
          binsReady: analyser.ready,
          smoothBuf,
          rgb,
          anchor,
        });
      }
      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(rafId);
      ctx.clearRect(0, 0, width, height);
    };
  }, [
    active,
    source,
    mic,
    playback,
    width,
    height,
    bars,
    smoothBuf,
    colorVar,
    colorFallback,
    anchor,
  ]);

  if (!active) return null;

  return (
    <span aria-hidden className={className}>
      <canvas ref={canvasRef} />
    </span>
  );
}
