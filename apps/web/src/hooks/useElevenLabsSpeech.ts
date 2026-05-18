/**
 * Phase C — premium TTS via the `/api/tts` ElevenLabs proxy.
 *
 * Mirrors the `SpeechSynthesisHook` interface from
 * `useSpeechSynthesis.ts` so callers can swap implementations behind a
 * facade without touching their UI. Streaming and queueing strategy:
 *
 *   - `speak(text)` opens a streaming POST to `/api/tts`, reads the
 *     response into a single Blob, wraps it in an object URL, and
 *     appends to a per-hook utterance queue.
 *   - A hidden `<audio>` element plays the queue head; when it ends
 *     (`onended`), the URL is revoked and the next utterance plays.
 *   - `pause` / `resume` defer to the underlying audio element.
 *   - `skip` advances the queue, revokes the current URL, and starts
 *     the next utterance immediately.
 *   - `clear` empties the queue and stops the player.
 *   - `setMuted` cancels in-flight playback and prevents future
 *     `speak` calls from producing audio until muted is set back to
 *     false (matching the browser-TTS hook's contract).
 *
 * The hook also exposes a `latestUsage` callback so `runTurn` can debit
 * cost telemetry with the character count returned by the proxy.
 *
 * Graceful fallback: when `available` is false (ElevenLabs key unset,
 * server unreachable, etc.) every action is a no-op so the caller can
 * unconditionally invoke the hook and rely on the parent facade to
 * pick browser TTS instead.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { readPrefs } from "../lib/userPreferences";
import { devBearer, devBypassAuth } from "../lib/devBypass";
import { supabase } from "../lib/supabase";
import { useSenecaStore } from "../store/seneca";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8787";

export interface ElevenLabsSpeechHook {
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

interface QueueItem {
  text: string;
  voiceId: string;
  sessionId: string | null;
  /** Resolved when this item is fetched + played + ended (or errored). */
  done: Promise<void>;
  abort: AbortController;
}

interface Options {
  /** Whether the ElevenLabs path is available (config flag). */
  available: boolean;
  /** Called with character count after each successful synth. */
  onUsage?: (chars: number, voiceId: string) => void;
  /** Called with a human message when synthesis fails. */
  onError?: (message: string) => void;
}

export function useElevenLabsSpeech(opts: Options): ElevenLabsSpeechHook {
  const { available, onUsage, onError } = opts;
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const playingRef = useRef<QueueItem | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // The latest callbacks live on a ref so the audio-element handlers
  // see fresh closures without re-binding.
  const onUsageRef = useRef(onUsage);
  onUsageRef.current = onUsage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    // Lazily allocate a hidden audio element the first time the hook
    // mounts in an available state. Stays alive for the page lifetime
    // so we don't leak listeners on every `speak`.
    if (!available) return;
    if (audioRef.current) return;
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    audioRef.current = el;
  }, [available]);

  const playNext = useCallback(async () => {
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = null;
      setSpeaking(false);
      setPaused(false);
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      playingRef.current = null;
      return;
    }
    playingRef.current = next;
    try {
      const blob = await fetchTts(
        next.text,
        next.voiceId,
        next.sessionId,
        next.abort.signal,
      );
      if (mutedRef.current) {
        // Muted between request and playback — drop silently.
        URL.revokeObjectURL(blob.url);
        void playNext();
        return;
      }
      audio.src = blob.url;
      setSpeaking(true);
      setPaused(false);
      try {
        await audio.play();
      } catch {
        // Autoplay denied? Treat as error and move on.
      }
      onUsageRef.current?.(blob.characters, next.voiceId);

      const cleanup = () => {
        URL.revokeObjectURL(blob.url);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onErrored);
      };
      const onEnded = () => {
        cleanup();
        void playNext();
      };
      const onErrored = () => {
        cleanup();
        onErrorRef.current?.("Audio playback failed.");
        void playNext();
      };
      audio.addEventListener("ended", onEnded, { once: true });
      audio.addEventListener("error", onErrored, { once: true });
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "AbortError" || err.code === DOMException.ABORT_ERR)
      ) {
        // Skipped or cleared — just advance.
        void playNext();
        return;
      }
      const msg =
        err instanceof Error ? err.message : "TTS request failed.";
      onErrorRef.current?.(msg);
      void playNext();
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!available) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      if (mutedRef.current) return;
      const prefs = readPrefs();
      if (!prefs.ttsAutoPlay) return;
      const voiceId = prefs.ttsVoiceId ?? "";
      const sessionId = useSenecaStore.getState().session.id;
      const item: QueueItem = {
        text: trimmed,
        voiceId,
        sessionId,
        abort: new AbortController(),
        done: Promise.resolve(),
      };
      queueRef.current.push(item);
      // If nothing is playing, kick the pump.
      if (!playingRef.current) void playNext();
    },
    [available, playNext],
  );

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play();
    setPaused(false);
  }, []);

  const skip = useCallback(() => {
    const current = playingRef.current;
    if (current) {
      current.abort.abort();
      playingRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
    }
    void playNext();
  }, [playNext]);

  const clear = useCallback(() => {
    const current = playingRef.current;
    if (current) current.abort.abort();
    for (const item of queueRef.current) item.abort.abort();
    queueRef.current = [];
    playingRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
    }
    setSpeaking(false);
    setPaused(false);
  }, []);

  const setMuted = useCallback(
    (m: boolean) => {
      setMutedState(m);
      if (m) clear();
    },
    [clear],
  );

  // Belt-and-braces sync: if the audio element ever transitions to
  // ended without firing our `ended` listener (rare), keep `speaking`
  // honest.
  useEffect(() => {
    if (!available) return;
    const audio = audioRef.current;
    if (!audio) return;
    const i = window.setInterval(() => {
      setSpeaking(!audio.paused && !audio.ended && audio.currentTime > 0);
    }, 750);
    return () => window.clearInterval(i);
  }, [available]);

  return {
    supported: available,
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

interface TtsBlob {
  url: string;
  characters: number;
  voiceId: string;
}

async function fetchTts(
  text: string,
  voiceId: string,
  sessionId: string | null,
  signal: AbortSignal,
): Promise<TtsBlob> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api/tts`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      voiceId: voiceId || undefined,
      sessionId: sessionId ?? undefined,
    }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as
      | { error?: string; kind?: string }
      | null;
    throw new Error(
      json?.error ?? `Premium TTS failed with ${res.status}`,
    );
  }
  const blob = await res.blob();
  const characters = Number(res.headers.get("X-Characters") ?? "0") || text.length;
  const resolvedVoiceId = res.headers.get("X-Voice-Id") ?? voiceId;
  return {
    url: URL.createObjectURL(blob),
    characters,
    voiceId: resolvedVoiceId,
  };
}

async function getToken(): Promise<string> {
  if (devBypassAuth) return devBearer;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}
