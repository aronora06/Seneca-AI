/**
 * Phase C — unified speech facade.
 *
 * Picks the premium ElevenLabs path when the server reports it's
 * available (`GET /api/tts/config`), otherwise falls back to the
 * browser's `SpeechSynthesisUtterance`. The user can force the
 * fallback path from Settings via the `ttsProvider` preference.
 *
 * The hook mirrors the shape of `useSpeechSynthesis` so the rest of
 * the UI doesn't care which engine is producing audio.
 *
 * The TTS-config probe is deduped via a module-level promise so
 * concurrent mounts don't refire the request. We deliberately do
 * NOT persist the result across reloads — a sticky cache used to
 * mean that adding an `ELEVENLABS_API_KEY` to `.env` after the tab
 * was already open required closing the tab to pick up. Every
 * full reload now re-probes the API once. The endpoint is a
 * sub-millisecond static read on the server, so the trade is cheap.
 */
import { useEffect, useState } from "react";

import { usePrefs } from "../lib/userPreferences";

import { useElevenLabsSpeech, type ElevenLabsSpeechHook } from "./useElevenLabsSpeech";
import { useSpeechSynthesis, type SpeechSynthesisHook } from "./useSpeechSynthesis";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8787";

export interface SpeechProviderInfo {
  available: boolean;
  defaultVoiceId: string | null;
  modelId: string | null;
  voices: CuratedVoice[];
}

export interface CuratedVoice {
  id: string;
  name: string;
  description: string;
}

let configPromise: Promise<SpeechProviderInfo> | null = null;

export function fetchTtsConfig(force = false): Promise<SpeechProviderInfo> {
  if (force) configPromise = null;
  if (configPromise) return configPromise;
  configPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tts/config`, {
        method: "GET",
      });
      if (!res.ok) throw new Error(`tts/config ${res.status}`);
      return (await res.json()) as SpeechProviderInfo;
    } catch {
      const offline: SpeechProviderInfo = {
        available: false,
        defaultVoiceId: null,
        modelId: null,
        voices: [],
      };
      return offline;
    }
  })();
  return configPromise;
}

export interface SpeechHook {
  supported: boolean;
  speaking: boolean;
  /** Queued / fetching / playing — use for activity visuals and echo gate. */
  audioActive: boolean;
  paused: boolean;
  muted: boolean;
  /** Which engine is actually producing audio right now. */
  engine: "elevenlabs" | "browser";
  setMuted: (m: boolean) => void;
  speak: (text: string) => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  clear: () => void;
  /** Available curated voices (empty when ElevenLabs is unconfigured). */
  voices: CuratedVoice[];
}

interface Options {
  /** Called with character count after each successful premium synth. */
  onUsage?: (chars: number, voiceId: string) => void;
  /** Called with a human message when synthesis fails. */
  onError?: (message: string) => void;
}

/**
 * Used in tests / Storybook to bypass the network probe.
 */
export function __setSpeechConfigForTests(info: SpeechProviderInfo | null) {
  if (info === null) {
    configPromise = null;
    return;
  }
  configPromise = Promise.resolve(info);
}

export function useSpeech(opts: Options = {}): SpeechHook {
  const prefs = usePrefs();
  const [info, setInfo] = useState<SpeechProviderInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchTtsConfig().then((next) => {
      if (!cancelled) setInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const useElevenLabs =
    !!info?.available && prefs.ttsProvider !== "browser";

  const browser = useSpeechSynthesis();
  const premium = useElevenLabsSpeech({
    available: useElevenLabs,
    onUsage: opts.onUsage,
    onError: opts.onError,
  });

  const active: ElevenLabsSpeechHook | SpeechSynthesisHook = useElevenLabs
    ? premium
    : browser;
  const engine: "elevenlabs" | "browser" = useElevenLabs ? "elevenlabs" : "browser";

  return {
    supported: active.supported,
    speaking: active.speaking,
    audioActive: active.audioActive,
    paused: active.paused,
    muted: active.muted,
    engine,
    setMuted: active.setMuted,
    speak: active.speak,
    pause: active.pause,
    resume: active.resume,
    skip: active.skip,
    clear: active.clear,
    voices: info?.voices ?? [],
  };
}
