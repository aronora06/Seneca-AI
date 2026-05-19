/**
 * useConversationVad — Silero VAD via @ricky0123/vad-web.
 *
 * What this hook is for:
 *
 *   Web Speech Recognition (the recognizer behind useSpeechRecognition)
 *   doesn't know whether the audio it's hearing is actually a human
 *   voice or just background sound — it just transcribes whatever it
 *   can. That's good enough for "press a button and dictate" flows, but
 *   it falls apart for hands-free conversation because:
 *
 *     - It can't reliably tell when the user *started* talking, which
 *       is what barge-in needs.
 *     - It can't reliably tell when the user *stopped*, which is what
 *       VAD-based auto-submit needs.
 *     - It happily transcribes the TTS output coming through the
 *       speakers, which our previous shipped fix avoided by simply
 *       stopping the recognizer during playback. That kills barge-in.
 *
 *   The pragmatic solution (the same one Say, Pi and other "wrap a
 *   chatbot for hands-free use" tools have shipped for years) is to
 *   add a *real* voice activity detector running independently of the
 *   recognizer. We use Silero VAD via @ricky0123/vad-web — an ONNX
 *   model that runs in an AudioWorklet on the raw mic stream and fires
 *   `onSpeechStart` / `onSpeechEnd` callbacks with millisecond
 *   precision.
 *
 *   The VAD lives next to the recognizer, not instead of it. The
 *   recognizer still does the actual transcription; the VAD just tells
 *   us *when* the user is talking so we can:
 *
 *     - Start/stop the recognizer at the right moments.
 *     - Trigger barge-in the instant speech begins (during TTS).
 *     - Auto-submit the captured transcript on speech-end without an
 *       arbitrary silence timer.
 *
 * Echo discipline:
 *
 *   Chrome's Web Audio path does not get the system-level echo
 *   cancellation that the WebRTC path gets (Chrome bug #687574). In
 *   practice Silero is robust enough to ignore most TTS leakage
 *   because it's been trained to distinguish voice from playback, but
 *   for belt-and-braces the caller can raise the speech threshold
 *   while TTS is playing — the hook exposes `setActivationThreshold`
 *   so the VoicePane can do this dynamically.
 *
 * Lifecycle:
 *
 *   - The hook is a noop until `start()` is called.
 *   - `start()` is async: it spins up the AudioWorklet, fetches the
 *     ONNX model from the configured asset paths, and requests mic
 *     permission via getUserMedia. Resolves to `{ ok: true }` or
 *     `{ ok: false, error }`.
 *   - `stop()` tears down the worklet, releases the mic, and resets
 *     state. Safe to call repeatedly.
 *   - Component unmount calls `stop()` automatically.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { getVadAssetPaths } from "../lib/vadAssets";

export type VadStartResult =
  | { ok: true }
  | { ok: false; error: string };

interface MicVadInstanceLike {
  start: () => void;
  pause: () => void;
  destroy: () => void;
  updateOptions?: (opts: Partial<{ positiveSpeechThreshold: number; negativeSpeechThreshold: number }>) => void;
}

interface MicVadModuleLike {
  MicVAD: {
    new: (opts: Record<string, unknown>) => Promise<MicVadInstanceLike>;
  };
}

export interface UseConversationVadOptions {
  /** Called the instant the user begins to speak. */
  onSpeechStart?: () => void;
  /**
   * Called when the user finishes speaking, with the raw audio
   * (Float32Array @ 16 kHz). We don't currently feed this anywhere
   * — Web Speech Recognition handles the transcription on its own
   * audio path — but it's available for future server-side STT.
   */
  onSpeechEnd?: (audio: Float32Array) => void;
  /**
   * Called if the VAD fires speech-start but then never crosses
   * `minSpeechFrames`. Useful for not over-triggering on coughs and
   * background ticks.
   */
  onVadMisfire?: () => void;
  /**
   * Silero positive-speech threshold (0..1). Lower = more sensitive
   * to quiet speech, higher = more conservative. Default 0.5 is fine
   * for most rooms; raise to 0.7 during TTS playback to avoid
   * tripping on echo leakage.
   */
  positiveSpeechThreshold?: number;
  /**
   * Silero negative-speech threshold (0..1). Should be lower than
   * positive. Default 0.35.
   */
  negativeSpeechThreshold?: number;
  /**
   * Minimum number of speech frames (~32 ms each) before a speech
   * segment is considered real. Default 3 (≈100 ms) — short enough
   * for snappy barge-in, long enough to skip a single cough.
   */
  minSpeechFrames?: number;
}

export interface ConversationVadHook {
  /** True once the model has loaded and the mic is open. */
  isReady: boolean;
  /** True between onSpeechStart and onSpeechEnd. */
  isSpeaking: boolean;
  /** Last init error, if any. */
  error: string | null;
  /** Initialise + start. Idempotent. */
  start: () => Promise<VadStartResult>;
  /** Tear down everything: worklet, mic, model. */
  stop: () => void;
  /** Raise / lower the activation threshold dynamically. */
  setActivationThreshold: (positive: number) => void;
}

export function useConversationVad(
  opts: UseConversationVadOptions = {},
): ConversationVadHook {
  const [isReady, setIsReady] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vadRef = useRef<MicVadInstanceLike | null>(null);
  const startingRef = useRef<Promise<VadStartResult> | null>(null);

  const onStartRef = useRef(opts.onSpeechStart);
  onStartRef.current = opts.onSpeechStart;
  const onEndRef = useRef(opts.onSpeechEnd);
  onEndRef.current = opts.onSpeechEnd;
  const onMisfireRef = useRef(opts.onVadMisfire);
  onMisfireRef.current = opts.onVadMisfire;

  const start = useCallback(async (): Promise<VadStartResult> => {
    if (vadRef.current) {
      vadRef.current.start();
      return { ok: true };
    }
    if (startingRef.current) return startingRef.current;

    const p = (async (): Promise<VadStartResult> => {
      try {
        // Dynamic import so the ~150 kB VAD client + onnxruntime-web
        // glue only loads when the user actually flips Conversation
        // Mode on. Vite produces a separate chunk; vitest's mock
        // interception relies on the literal specifier so we don't
        // hide it behind a variable.
        const mod = (await import(
          "@ricky0123/vad-web"
        )) as unknown as MicVadModuleLike;
        const paths = getVadAssetPaths();

        const vad = await mod.MicVAD.new({
          baseAssetPath: paths.baseAssetPath,
          onnxWASMBasePath: paths.onnxWASMBasePath,
          model: "v5",
          positiveSpeechThreshold: opts.positiveSpeechThreshold ?? 0.5,
          negativeSpeechThreshold: opts.negativeSpeechThreshold ?? 0.35,
          minSpeechFrames: opts.minSpeechFrames ?? 3,
          onSpeechStart: () => {
            setIsSpeaking(true);
            onStartRef.current?.();
          },
          onSpeechEnd: (audio: Float32Array) => {
            setIsSpeaking(false);
            onEndRef.current?.(audio);
          },
          onVADMisfire: () => {
            setIsSpeaking(false);
            onMisfireRef.current?.();
          },
        });

        vad.start();
        vadRef.current = vad;
        setIsReady(true);
        setError(null);
        return { ok: true };
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Unknown VAD init error";
        setError(msg);
        setIsReady(false);
        return { ok: false, error: msg };
      } finally {
        startingRef.current = null;
      }
    })();

    startingRef.current = p;
    return p;
  }, [
    opts.minSpeechFrames,
    opts.negativeSpeechThreshold,
    opts.positiveSpeechThreshold,
  ]);

  const stop = useCallback(() => {
    const v = vadRef.current;
    vadRef.current = null;
    startingRef.current = null;
    setIsReady(false);
    setIsSpeaking(false);
    if (v) {
      try {
        v.pause();
      } catch {
        // ignore
      }
      try {
        v.destroy();
      } catch {
        // ignore
      }
    }
  }, []);

  const setActivationThreshold = useCallback((positive: number) => {
    const v = vadRef.current;
    if (!v?.updateOptions) return;
    // Negative threshold is kept at ~0.7 of positive, mirroring the
    // package's own default ratio.
    const next = clamp01(positive);
    try {
      v.updateOptions({
        positiveSpeechThreshold: next,
        negativeSpeechThreshold: clamp01(next * 0.7),
      });
    } catch {
      // Older builds of vad-web don't expose updateOptions; the
      // initial values from start() still apply.
    }
  }, []);

  // Always release the mic + worklet on unmount.
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isReady,
    isSpeaking,
    error,
    start,
    stop,
    setActivationThreshold,
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.5;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
