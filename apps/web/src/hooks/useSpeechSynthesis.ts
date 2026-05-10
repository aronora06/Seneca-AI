/**
 * Wraps `window.speechSynthesis` in a React-friendly hook.
 *
 * Behaviour:
 *   - `speak(text)` queues an utterance. Successive calls queue rather than interrupt.
 *   - `pause()` / `resume()` toggle the engine globally.
 *   - `skip()` cancels the currently-speaking utterance, advancing to the next.
 *   - `clear()` cancels everything queued.
 *   - `setMuted(true)` cancels any in-flight speech and prevents future `speak` calls
 *     from producing audio until muted is set back to false.
 *   - Picks the best available English voice once voices are loaded.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface SpeechSynthesisHook {
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  speak: (text: string) => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  clear: () => void;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window))
    return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Prefer high-quality / "Natural" voices, English, anywhere.
  const score = (v: SpeechSynthesisVoice): number => {
    let n = 0;
    if (v.lang.startsWith("en")) n += 50;
    if (v.lang === "en-US" || v.lang === "en-GB") n += 5;
    if (/natural|enhanced|premium|neural/i.test(v.name)) n += 30;
    if (/google|microsoft|samantha/i.test(v.name)) n += 5;
    if (v.default) n += 2;
    return n;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function useSpeechSynthesis(): SpeechSynthesisHook {
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!supported) return;
    const update = () => {
      voiceRef.current = pickVoice();
    };
    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", update);
    };
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim() || muted) return;
      const utter = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utter.voice = voiceRef.current;
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.onstart = () => {
        setSpeaking(true);
        setPaused(false);
      };
      utter.onend = () => {
        setSpeaking(window.speechSynthesis.speaking);
      };
      utter.onerror = () => {
        setSpeaking(window.speechSynthesis.speaking);
      };
      window.speechSynthesis.speak(utter);
    },
    [supported, muted],
  );

  const pause = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, [supported]);

  const resume = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }, [supported]);

  const skip = useCallback(() => {
    if (!supported) return;
    // Cancel() flushes the queue; for a single-skip we can cancel and rely on
    // the caller to push remaining items. For our simple use case (one
    // assistant turn = one utterance), cancel == skip.
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }, [supported]);

  const clear = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  }, [supported]);

  const setMuted = useCallback(
    (m: boolean) => {
      setMutedState(m);
      if (m) clear();
    },
    [clear],
  );

  // Keep `speaking` in sync if the engine state drifts (e.g. external cancel).
  useEffect(() => {
    if (!supported) return;
    const i = window.setInterval(() => {
      setSpeaking(window.speechSynthesis.speaking);
      setPaused(window.speechSynthesis.paused);
    }, 500);
    return () => window.clearInterval(i);
  }, [supported]);

  return {
    supported,
    speaking,
    paused,
    muted,
    setMuted,
    speak,
    pause,
    resume,
    skip,
    clear,
  };
}
