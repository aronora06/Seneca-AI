/**
 * Phase C — premium TTS via the `/api/tts` ElevenLabs proxy.
 *
 * Queue model:
 *   - Each `speak()` enqueues a sentence and **starts fetching immediately**
 *     (prefetch) so playback does not wait on network after the prior sentence.
 *   - A single pump loop plays items in order (no recursive playNext races).
 *   - `clear()` aborts in-flight work — call before each new user turn so stale
 *     sentences from a prior response cannot play a minute later.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { registerPlaybackAudio } from "../lib/playbackAudioRegistry";
import { playTtsResponse } from "../lib/streamTtsPlayback";
import { ttsLog } from "../lib/ttsTimeline";
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

interface QueueItem {
  id: number;
  text: string;
  voiceId: string;
  sessionId: string | null;
  abort: AbortController;
  /** Begins when the item is enqueued — not when playback starts. */
  fetchPromise: Promise<Response>;
}

interface Options {
  available: boolean;
  onUsage?: (chars: number, voiceId: string) => void;
  onError?: (message: string) => void;
}

let nextItemId = 0;

/** Avoid hammering /api/tts when many sentences enqueue during one turn. */
const MAX_CONCURRENT_TTS_FETCHES = 3;

/**
 * Cap pending sentences waiting to play. Beyond this we merge older
 * queued lines into one fetch so a long reply cannot trail by minutes.
 */
const MAX_QUEUED_ITEMS = 4;
let activeTtsFetches = 0;
const fetchWaiters: Array<() => void> = [];

async function acquireTtsFetchSlot(): Promise<void> {
  if (activeTtsFetches < MAX_CONCURRENT_TTS_FETCHES) {
    activeTtsFetches++;
    return;
  }
  await new Promise<void>((resolve) => {
    fetchWaiters.push(() => {
      activeTtsFetches++;
      resolve();
    });
  });
}

function releaseTtsFetchSlot(): void {
  activeTtsFetches = Math.max(0, activeTtsFetches - 1);
  const next = fetchWaiters.shift();
  if (next) next();
}

async function fetchTtsGated(
  text: string,
  voiceId: string,
  sessionId: string | null,
  signal: AbortSignal,
): Promise<Response> {
  await acquireTtsFetchSlot();
  try {
    return await fetchTtsResponse(text, voiceId, sessionId, signal);
  } finally {
    releaseTtsFetchSlot();
  }
}

export function useElevenLabsSpeech(opts: Options): ElevenLabsSpeechHook {
  const { available, onUsage, onError } = opts;
  const [speaking, setSpeaking] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMutedState] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const playingRef = useRef<QueueItem | null>(null);
  const pumpingRef = useRef(false);
  /** Bumped on clear/skip so an in-flight pump exits without touching state. */
  const pumpGenRef = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const onUsageRef = useRef(onUsage);
  onUsageRef.current = onUsage;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!available) return;
    if (audioRef.current) return;
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    audioRef.current = el;
    registerPlaybackAudio(el);
    return () => {
      registerPlaybackAudio(null);
    };
  }, [available]);

  const syncAudioActive = useCallback(() => {
    const audible =
      !!audioRef.current &&
      !audioRef.current.paused &&
      !audioRef.current.ended &&
      audioRef.current.currentTime > 0;
    setAudioActive(
      queueRef.current.length > 0 || playingRef.current !== null || audible,
    );
    setSpeaking(audible);
  }, []);

  const resetAudioElement = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {
      // load() can throw if the element is in a bad state — safe to ignore.
    }
  }, []);

  const ensurePump = useCallback(async () => {
    if (pumpingRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;

    const gen = pumpGenRef.current;
    pumpingRef.current = true;
    setAudioActive(true);

    try {
      while (queueRef.current.length > 0) {
        if (pumpGenRef.current !== gen) {
          ttsLog("pump.stale", { gen, currentGen: pumpGenRef.current });
          break;
        }
        const next = queueRef.current.shift()!;
        playingRef.current = next;

        ttsLog("pump.play", {
          id: next.id,
          queueRemaining: queueRef.current.length,
          chars: next.text.length,
          preview: next.text.slice(0, 72),
        });

        try {
          const tFetch = performance.now();
          const res = await next.fetchPromise;
          if (pumpGenRef.current !== gen) {
            ttsLog("pump.stale", { id: next.id, phase: "after_fetch" });
            break;
          }
          ttsLog("pump.fetched", {
            id: next.id,
            ms: Math.round(performance.now() - tFetch),
            status: res.status,
          });

          if (mutedRef.current) continue;

          const tPlay = performance.now();
          const meta = await playTtsResponse({
            res,
            audio,
            signal: next.abort.signal,
            fallbackTextLength: next.text.length,
            fallbackVoiceId: next.voiceId,
            onPlaybackStart: () => {
              setSpeaking(true);
              setPaused(false);
            },
          });

          ttsLog("pump.played", {
            id: next.id,
            ms: Math.round(performance.now() - tPlay),
          });

          onUsageRef.current?.(meta.characters, meta.voiceId);
        } catch (err) {
          if (
            err instanceof DOMException &&
            (err.name === "AbortError" ||
              err.code === DOMException.ABORT_ERR)
          ) {
            ttsLog("pump.aborted", { id: next.id });
            continue;
          }
          const msg =
            err instanceof Error ? err.message : "TTS request failed.";
          ttsLog("pump.error", { id: next.id, message: msg });
          onErrorRef.current?.(msg);
        }
      }
    } finally {
      playingRef.current = null;
      if (pumpGenRef.current === gen) {
        pumpingRef.current = false;
        syncAudioActive();
        if (queueRef.current.length > 0) {
          void ensurePump();
        }
      } else {
        pumpingRef.current = false;
        ttsLog("pump.superseded", { gen });
      }
    }
  }, [syncAudioActive]);

  const makeQueueItem = useCallback(
    (
      trimmed: string,
      voiceId: string,
      sessionId: string | null,
    ): QueueItem => {
      const abort = new AbortController();
      const id = ++nextItemId;
      return {
        id,
        text: trimmed,
        voiceId,
        sessionId,
        abort,
        fetchPromise: fetchTtsGated(
          trimmed,
          voiceId,
          sessionId,
          abort.signal,
        ),
      };
    },
    [],
  );

  const coalesceOverflowQueue = useCallback(
    (voiceId: string, sessionId: string | null) => {
      const queue = queueRef.current;
      while (queue.length > MAX_QUEUED_ITEMS) {
        const excessCount = queue.length - MAX_QUEUED_ITEMS;
        const excess = queue.splice(0, excessCount);
        const mergedText = excess.map((i) => i.text).join(" ");
        for (const item of excess) item.abort.abort();
        const merged = makeQueueItem(mergedText, voiceId, sessionId);
        queue.unshift(merged);
        ttsLog("speak.coalesce", {
          id: merged.id,
          mergedCount: excessCount,
          chars: mergedText.length,
          queueLen: queue.length,
        });
      }
    },
    [makeQueueItem],
  );

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

      const item = makeQueueItem(trimmed, voiceId, sessionId);
      queueRef.current.push(item);
      coalesceOverflowQueue(voiceId, sessionId);
      setAudioActive(true);

      ttsLog("speak.enqueue", {
        id: item.id,
        queueLen: queueRef.current.length,
        chars: trimmed.length,
        preview: trimmed.slice(0, 72),
      });

      void ensurePump();
    },
    [available, coalesceOverflowQueue, ensurePump, makeQueueItem],
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

  const stopPlayback = useCallback(() => {
    pumpGenRef.current += 1;
    const current = playingRef.current;
    if (current) current.abort.abort();
    for (const item of queueRef.current) item.abort.abort();
    queueRef.current = [];
    playingRef.current = null;
    resetAudioElement();
    setSpeaking(false);
    setAudioActive(false);
    setPaused(false);
  }, [resetAudioElement]);

  const skip = useCallback(() => {
    ttsLog("skip");
    stopPlayback();
    void ensurePump();
  }, [stopPlayback, ensurePump]);

  const clear = useCallback(() => {
    ttsLog("clear", { hadQueue: queueRef.current.length });
    stopPlayback();
    // Aborted fetches still release slots in finally; no drain needed.
  }, [stopPlayback]);

  const setMuted = useCallback(
    (m: boolean) => {
      setMutedState(m);
      if (m) clear();
    },
    [clear],
  );

  useEffect(() => {
    if (!available) return;
    const audio = audioRef.current;
    if (!audio) return;
    const i = window.setInterval(() => syncAudioActive(), 200);
    return () => window.clearInterval(i);
  }, [available, syncAudioActive]);

  return {
    supported: available,
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

const TTS_FETCH_TIMEOUT_MS = 45_000;

async function fetchTtsResponse(
  text: string,
  voiceId: string,
  sessionId: string | null,
  signal: AbortSignal,
): Promise<Response> {
  const token = await getToken();
  const timeout = AbortSignal.timeout(TTS_FETCH_TIMEOUT_MS);
  const combined =
    typeof AbortSignal.any === "function"
      ? AbortSignal.any([signal, timeout])
      : signal;
  return fetch(`${API_BASE}/api/tts`, {
    method: "POST",
    signal: combined,
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
}

async function getToken(): Promise<string> {
  if (devBypassAuth) return devBearer;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}
