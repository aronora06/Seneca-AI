/**
 * Wraps `window.speechSynthesis` in a React-friendly hook.
 *
 * Reads voice, rate, and pitch preferences from userPreferences (localStorage).
 * When the user changes them in Settings, the next `speak()` call picks them up.
 *
 * Behaviour:
 *   - `speak(text)` queues an utterance. Successive calls queue rather than interrupt.
 *   - `pause()` / `resume()` toggle the engine globally.
 *   - `skip()` cancels the currently-speaking utterance, advancing to the next.
 *   - `clear()` cancels everything queued.
 *   - `setMuted(true)` cancels any in-flight speech and prevents future `speak` calls
 *     from producing audio until muted is set back to false.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readPrefs } from "../lib/userPreferences";

export interface SpeechSynthesisHook {
  supported: boolean;
  speaking: boolean;
  /** Mirrors `speaking` for browser TTS (no separate fetch queue). */
  audioActive: boolean;
  paused: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  speak: (text: string) => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  clear: () => void;
}

function pickVoice(preferredURI: string | null): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window))
    return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  if (preferredURI) {
    const match = voices.find((v) => v.voiceURI === preferredURI);
    if (match) return match;
  }

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
  const [audioActive, setAudioActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!supported) return;
    const update = () => {
      const prefs = readPrefs();
      voiceRef.current = pickVoice(prefs.ttsVoiceURI);
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
      const prefs = readPrefs();
      if (!prefs.ttsAutoPlay && !muted) return;

      const utter = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(prefs.ttsVoiceURI);
      if (voice) {
        utter.voice = voice;
        voiceRef.current = voice;
      }
      utter.rate = prefs.ttsRate;
      utter.pitch = prefs.ttsPitch;
      setAudioActive(true);
      utter.onstart = () => {
        setSpeaking(true);
        setAudioActive(true);
        setPaused(false);
      };
      utter.onend = () => {
        const busy = window.speechSynthesis.speaking;
        setSpeaking(busy);
        setAudioActive(busy);
      };
      utter.onerror = () => {
        const busy = window.speechSynthesis.speaking;
        setSpeaking(busy);
        setAudioActive(busy);
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
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setAudioActive(false);
    setPaused(false);
  }, [supported]);

  const clear = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setAudioActive(false);
    setPaused(false);
  }, [supported]);

  const setMuted = useCallback(
    (m: boolean) => {
      setMutedState(m);
      if (m) clear();
    },
    [clear],
  );

  useEffect(() => {
    if (!supported) return;
    const i = window.setInterval(() => {
      const busy = window.speechSynthesis.speaking;
      setSpeaking(busy);
      setAudioActive(busy);
      setPaused(window.speechSynthesis.paused);
    }, 500);
    return () => window.clearInterval(i);
  }, [supported]);

  return {
    supported,
    speaking,
    audioActive,
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
