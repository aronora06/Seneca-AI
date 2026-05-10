/**
 * Wraps the Web Speech Recognition API in a React-friendly hook.
 *
 * Behaviour:
 *   - `interim` text streams as the user speaks; `final` fires once a chunk
 *     is committed by the recognizer.
 *   - In continuous mode, `onend` auto-restarts the recognizer until the
 *     caller toggles continuous off or explicitly stops.
 *   - We never throw from event handlers; errors are surfaced via `error`.
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
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;

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
      if (interimText) setInterim(interimText.trim());
      if (finalText.trim()) {
        setInterim("");
        onFinalRef.current(finalText.trim());
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
      if (continuousRef.current && !manualStopRef.current) {
        try {
          rec.start();
        } catch {
          // already started or browser denied; ignore
        }
      }
      manualStopRef.current = false;
    };

    recognitionRef.current = rec;
    return rec;
  }, [Ctor, opts.lang]);

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
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return { supported, isListening, interim, error, start, stop, setContinuous };
}
