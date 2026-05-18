/**
 * Wraps the Web Speech Recognition API in a React-friendly hook.
 *
 * Phase B — dictation surface:
 *   - `interim` text streams as the user speaks; `final` fires once a
 *     chunk is committed by the recognizer.
 *   - `onInterim` (optional) fires for every interim update; the legacy
 *     `interim` state stays for callers that only need the latest
 *     snapshot.
 *   - `onSilence` (optional) fires after a configurable quiet period
 *     following the most recent committed `final` chunk. This is how
 *     the hands-free VAD path auto-submits a multi-sentence utterance
 *     without an extra library.
 *   - In continuous mode, `onend` auto-restarts the recognizer until
 *     the caller toggles continuous off or explicitly stops.
 *   - We never throw from event handlers; errors are surfaced via
 *     `error`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface SpeechRecognitionHook {
  supported: boolean;
  isListening: boolean;
  interim: string;
  error: string | null;
  /** Begin a single utterance recognition (push-to-talk). */
  start: () => void;
  /** Stop the recognizer. In continuous mode this disables auto-restart. */
  stop: () => void;
  /** Toggle "always on" mode. */
  setContinuous: (on: boolean) => void;
}

interface Options {
  lang?: string;
  onFinal: (text: string) => void;
  /**
   * Optional: receive every interim text update. Use this when you
   * want to render the in-flight transcript live (e.g. as ghost text
   * in a dictation surface).
   */
  onInterim?: (text: string) => void;
  /**
   * Optional: fires once after the user stops talking for at least
   * `silenceMs` following the most recent committed `final` chunk.
   * The argument is whatever text the consumer has accumulated since
   * the last silence event (returned from `onFinal`). The hook itself
   * doesn't accumulate — the consumer concatenates and decides when
   * to act. We expose the timer so the consumer can wire VAD-style
   * auto-submit without writing its own debounce.
   */
  onSilence?: () => void;
  /**
   * Quiet period after the last `final` chunk before `onSilence`
   * fires, in milliseconds. Defaults to 1500ms (matches Phase B
   * roadmap). Set to 0 to disable the timer entirely.
   */
  silenceMs?: number;
}

function getCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(opts: Options): SpeechRecognitionHook {
  const Ctor = getCtor();
  const supported = Boolean(Ctor);

  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const continuousRef = useRef(false);
  const manualStopRef = useRef(false);

  // Latest-value refs for every callback so we can swap them between
  // renders without rebuilding the recognizer.
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;
  const onInterimRef = useRef(opts.onInterim);
  onInterimRef.current = opts.onInterim;
  const onSilenceRef = useRef(opts.onSilence);
  onSilenceRef.current = opts.onSilence;
  const silenceMsRef = useRef(opts.silenceMs ?? 1500);
  silenceMsRef.current = opts.silenceMs ?? 1500;

  // Silence timer — runs in real time, restarted on every interim /
  // final result, fired when the configured quiet period elapses with
  // at least one final result on the books.
  const silenceTimerRef = useRef<number | null>(null);
  const hadFinalSinceFireRef = useRef(false);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const scheduleSilence = useCallback(() => {
    clearSilenceTimer();
    const cb = onSilenceRef.current;
    const ms = silenceMsRef.current;
    if (!cb || ms <= 0) return;
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null;
      if (!hadFinalSinceFireRef.current) return;
      hadFinalSinceFireRef.current = false;
      cb();
    }, ms);
  }, [clearSilenceTimer]);

  // Construct lazily once we know we'll use it.
  const ensure = useCallback((): SpeechRecognition | null => {
    if (!Ctor) return null;
    if (recognitionRef.current) return recognitionRef.current;

    const rec = new Ctor();
    rec.lang = opts.lang ?? "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) {
          finalText += alt.transcript;
        } else {
          interimText += alt.transcript;
        }
      }
      if (interimText) {
        const next = interimText.trim();
        setInterim(next);
        onInterimRef.current?.(next);
        // Interim activity counts as "still talking" — push the
        // silence timer forward, but don't fire if no final has landed.
        scheduleSilence();
      }
      if (finalText.trim()) {
        setInterim("");
        onInterimRef.current?.("");
        onFinalRef.current(finalText.trim());
        hadFinalSinceFireRef.current = true;
        scheduleSilence();
      }
    };

    rec.onerror = (event) => {
      const code = event.error || "unknown";
      // Most error codes are noisy / transient. Suppress the routine ones
      // and translate the rest into a human message that we auto-dismiss
      // after a few seconds so it can't sit on screen forever.
      const SUPPRESS = new Set([
        "no-speech",
        "aborted",
        "network",
        "audio-capture",
      ]);
      if (SUPPRESS.has(code)) return;
      const friendly =
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone access was denied."
          : event.message || `Speech recognizer error: ${code}`;
      setError(friendly);
      window.setTimeout(() => setError(null), 4000);
    };

    rec.onstart = () => setIsListening(true);

    rec.onend = () => {
      setIsListening(false);
      setInterim("");
      onInterimRef.current?.("");
      if (continuousRef.current && !manualStopRef.current) {
        try {
          rec.start();
        } catch {
          // already started or browser denied; ignore
        }
      } else {
        // Recognizer is fully stopped — flush any pending silence so a
        // PTT release with a tail-end final still hits onSilence in the
        // hands-free path.
        if (hadFinalSinceFireRef.current && onSilenceRef.current) {
          hadFinalSinceFireRef.current = false;
          clearSilenceTimer();
          onSilenceRef.current();
        } else {
          clearSilenceTimer();
        }
      }
      manualStopRef.current = false;
    };

    recognitionRef.current = rec;
    return rec;
  }, [Ctor, opts.lang, scheduleSilence, clearSilenceTimer]);

  const start = useCallback(() => {
    setError(null);
    const rec = ensure();
    if (!rec) return;
    try {
      rec.start();
    } catch {
      // start() throws if already running; safe to ignore
    }
  }, [ensure]);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    continuousRef.current = false;
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  const setContinuous = useCallback(
    (on: boolean) => {
      continuousRef.current = on;
      if (on) {
        start();
      } else {
        stop();
      }
    },
    [start, stop],
  );

  useEffect(() => {
    return () => {
      manualStopRef.current = true;
      continuousRef.current = false;
      clearSilenceTimer();
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [clearSilenceTimer]);

  return { supported, isListening, interim, error, start, stop, setContinuous };
}
