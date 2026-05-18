/**
 * Phase B — microphone-level analyser.
 *
 * Opens a microphone stream and wires it to a Web Audio AnalyserNode so
 * downstream UI (the waveform bar chart next to push-to-talk) can read
 * the live frequency spectrum and RMS level. The hook is fully passive
 * until `active` flips true so an unused waveform component never asks
 * for mic permission.
 *
 * Cleanup discipline:
 *   - Closes the AudioContext when `active` goes false or the
 *     component unmounts.
 *   - Stops every track on the MediaStream so the OS-level mic
 *     indicator turns off promptly.
 *   - No animation frames are scheduled inside the hook itself — the
 *     consumer drives reads via `getLevel()` / `getFrequencyBins()`,
 *     so a paused waveform doesn't keep the CPU awake.
 *
 * Graceful degradation: if `navigator.mediaDevices.getUserMedia` is
 * unavailable (Safari extension contexts, locked-down deployments) or
 * the user denies the mic prompt, the hook stays in `supported: false`
 * / `error: ...` rather than throwing. Components should fall back to
 * a status pill or a static icon in that case.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface MicAnalyserHook {
  /** True iff the platform exposes both AudioContext and getUserMedia. */
  supported: boolean;
  /** True once the mic has been acquired and the analyser is wired. */
  ready: boolean;
  /** User-friendly error message when acquisition fails. */
  error: string | null;
  /**
   * Returns the current root-mean-square audio level in [0, 1].
   * Returns 0 when the analyser is not ready. Cheap; safe to call
   * inside a requestAnimationFrame loop.
   */
  getLevel: () => number;
  /**
   * Returns a Uint8Array of frequency-domain bin values in [0, 255].
   * Allocates once per call — pass an existing buffer to reuse it.
   * Returns a zero-filled array when the analyser is not ready.
   */
  getFrequencyBins: (
    target?: Uint8Array<ArrayBuffer>,
  ) => Uint8Array<ArrayBuffer>;
  /** How many bins `getFrequencyBins` returns. */
  binCount: number;
}

interface Options {
  /** Whether to keep the analyser open. */
  active: boolean;
  /** FFT size; defaults to 256 (= 128 bins, smooth for small bar charts). */
  fftSize?: 64 | 128 | 256 | 512 | 1024 | 2048;
  /** Smoothing time constant (0..1). Higher = more sluggish. */
  smoothing?: number;
}

function hasGetUserMedia(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function hasAudioContext(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.AudioContext !== "undefined" ||
    typeof (window as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext !== "undefined"
  );
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

export function useMicAnalyser(opts: Options): MicAnalyserHook {
  const { active, fftSize = 256, smoothing = 0.6 } = opts;
  const supported = hasGetUserMedia() && hasAudioContext();

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Backing buffers use a real `ArrayBuffer` (not the generic
  // `ArrayBufferLike` that `new Uint8Array(n)` defaults to in lib.dom
  // d.ts 5.7+) so the AnalyserNode setters accept them without a cast.
  const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const binCountRef = useRef(0);

  const teardown = useCallback(() => {
    try {
      analyserRef.current?.disconnect();
    } catch {
      // ignore — graph may already be detached
    }
    analyserRef.current = null;
    timeDataRef.current = null;
    freqDataRef.current = null;
    binCountRef.current = 0;

    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
    }
    streamRef.current = null;

    const ctx = ctxRef.current;
    if (ctx && ctx.state !== "closed") {
      // close() returns a promise; ignore the result, we don't need to
      // wait for it. Some browsers throw if called twice.
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    }
    ctxRef.current = null;

    setReady(false);
  }, []);

  useEffect(() => {
    if (!active || !supported) {
      teardown();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const Ctor = getAudioContextCtor();
        if (!Ctor) {
          setError("AudioContext not supported.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        const ctx = new Ctor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = fftSize;
        analyser.smoothingTimeConstant = smoothing;
        source.connect(analyser);

        ctxRef.current = ctx;
        streamRef.current = stream;
        analyserRef.current = analyser;
        binCountRef.current = analyser.frequencyBinCount;
        timeDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        freqDataRef.current = new Uint8Array(
          new ArrayBuffer(analyser.frequencyBinCount),
        );

        setError(null);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error
            ? err.name === "NotAllowedError"
              ? "Microphone access was denied."
              : err.message
            : "Could not open the microphone.";
        setError(msg);
        teardown();
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [active, supported, fftSize, smoothing, teardown]);

  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    const buf = timeDataRef.current;
    if (!analyser || !buf) return 0;
    analyser.getByteTimeDomainData(buf);
    // RMS over the centered ±128 waveform, normalised to [0, 1].
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i]! - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }, []);

  const getFrequencyBins = useCallback(
    (target?: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
      const analyser = analyserRef.current;
      if (!analyser) {
        // Return a zero-filled buffer to keep the call signature stable.
        return (
          target ??
          new Uint8Array(new ArrayBuffer(binCountRef.current || 0))
        );
      }
      const buf =
        target ??
        freqDataRef.current ??
        new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      analyser.getByteFrequencyData(buf);
      return buf;
    },
    [],
  );

  return {
    supported,
    ready,
    error,
    getLevel,
    getFrequencyBins,
    binCount: binCountRef.current,
  };
}
