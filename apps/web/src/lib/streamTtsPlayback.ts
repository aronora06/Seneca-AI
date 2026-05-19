/**
 * Progressive MP3 playback for `/api/tts` via MediaSource Extensions.
 *
 * The API already streams bytes; this module appends chunks to a
 * SourceBuffer so `<audio>` can start before the full sentence arrives.
 * Falls back to blob URLs when MSE + MP3 is unavailable (Safari) or when
 * MSE playback stalls after the stream has finished buffering.
 */

import { ttsLog } from "./ttsTimeline";

export const MIN_BUFFER_BEFORE_PLAY_SEC = 0.25;

const MIME = "audio/mpeg";

/** Safety cap — stall watchdog should fire long before this. */
export const PLAYBACK_END_TIMEOUT_MS = 30_000;

/** Only detect stalls after the full MP3 has been buffered. */
const PLAYBACK_STALL_MS = 8_000;

const MIN_CURRENT_TIME_FOR_BUFFER_END = 0.05;

export interface TtsPlaybackMeta {
  characters: number;
  voiceId: string;
}

/** Thrown when MSE buffers audio but the element never starts playing. */
export class PlaybackStallError extends Error {
  constructor(message = "Audio playback stalled") {
    super(message);
    this.name = "PlaybackStallError";
  }
}

export interface WaitForPlaybackEndOptions {
  /** When false, only `ended` and the safety timeout apply (streaming phase). */
  detectStall?: boolean;
}

export function isStreamingPlaybackSupported(): boolean {
  return (
    typeof MediaSource !== "undefined" &&
    MediaSource.isTypeSupported(MIME)
  );
}

function parseMeta(
  res: Response,
  fallbackTextLength: number,
  fallbackVoiceId: string,
): TtsPlaybackMeta {
  return {
    characters:
      Number(res.headers.get("X-Characters") ?? "0") || fallbackTextLength,
    voiceId: res.headers.get("X-Voice-Id") ?? fallbackVoiceId,
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function waitSourceBufferUpdateEnd(sb: SourceBuffer): Promise<void> {
  if (!sb.updating) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("SourceBuffer update failed"));
    };
    const cleanup = () => {
      sb.removeEventListener("updateend", onEnd);
      sb.removeEventListener("error", onError);
    };
    sb.addEventListener("updateend", onEnd);
    sb.addEventListener("error", onError);
  });
}

async function appendToSourceBuffer(
  sb: SourceBuffer,
  chunk: Uint8Array,
): Promise<void> {
  await waitSourceBufferUpdateEnd(sb);
  sb.appendBuffer(new Uint8Array(chunk));
  await waitSourceBufferUpdateEnd(sb);
}

function bufferedSeconds(sb: SourceBuffer): number {
  if (sb.buffered.length === 0) return 0;
  return sb.buffered.end(sb.buffered.length - 1);
}

function mediaBufferedEnd(audio: HTMLAudioElement): number {
  const b = audio.buffered;
  if (b.length === 0) return 0;
  return b.end(b.length - 1);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function releaseMediaSource(
  audio: HTMLAudioElement,
  objectUrl: string,
  mediaSource: MediaSource,
): void {
  URL.revokeObjectURL(objectUrl);
  try {
    if (mediaSource.readyState === "open") {
      mediaSource.endOfStream();
    }
  } catch {
    // ignore
  }
  audio.pause();
  audio.removeAttribute("src");
  try {
    audio.load();
  } catch {
    // ignore
  }
}

async function tryPlay(audio: HTMLAudioElement): Promise<boolean> {
  try {
    await audio.play();
    ttsLog("playback.playOk", { paused: audio.paused });
    return true;
  } catch (err) {
    ttsLog("playback.playRejected", {
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Wait until audible playback finishes. MediaSource + MP3 sometimes
 * fails to fire `ended` reliably; we poll currentTime vs buffered end,
 * optionally detect stalls after the stream is fully buffered, and
 * apply a safety timeout.
 */
export async function waitUntilPlaybackEnds(
  audio: HTMLAudioElement,
  signal: AbortSignal,
  options: WaitForPlaybackEndOptions = {},
): Promise<void> {
  const detectStall = options.detectStall ?? true;
  if (audio.ended) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let lastTime = audio.currentTime;
    let lastAdvanceAt = performance.now();
    const waitStartedAt = performance.now();

    const finish = (why: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      ttsLog("playback.end", { why, currentTime: audio.currentTime });
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onEnded = () => finish("ended_event");
    const onError = () => fail(new Error("Audio playback failed"));

    const poll = window.setInterval(() => {
      if (signal.aborted) {
        fail(new DOMException("Aborted", "AbortError"));
        return;
      }
      if (audio.ended) {
        finish("ended_poll");
        return;
      }

      const now = performance.now();
      const end = mediaBufferedEnd(audio);

      if (audio.currentTime > lastTime + 0.01) {
        lastTime = audio.currentTime;
        lastAdvanceAt = now;
      } else if (
        detectStall &&
        end >= MIN_BUFFER_BEFORE_PLAY_SEC &&
        now - waitStartedAt >= PLAYBACK_STALL_MS &&
        now - lastAdvanceAt >= PLAYBACK_STALL_MS &&
        audio.currentTime < MIN_CURRENT_TIME_FOR_BUFFER_END
      ) {
        ttsLog("playback.stall", {
          currentTime: audio.currentTime,
          bufferedEnd: end,
          paused: audio.paused,
        });
        fail(new PlaybackStallError());
        return;
      }

      if (
        end > 0 &&
        !audio.paused &&
        audio.currentTime > MIN_CURRENT_TIME_FOR_BUFFER_END &&
        audio.currentTime >= end - 0.15
      ) {
        finish("buffer_exhausted");
      }
    }, 200);

    const timeout = window.setTimeout(() => {
      finish("timeout");
    }, PLAYBACK_END_TIMEOUT_MS);

    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      window.clearInterval(poll);
      window.clearTimeout(timeout);
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
  });
}

async function playBytesAsBlob(opts: {
  audio: HTMLAudioElement;
  signal: AbortSignal;
  bytes: Uint8Array;
  meta: TtsPlaybackMeta;
  onPlaybackStart?: () => void;
  reason: string;
}): Promise<TtsPlaybackMeta> {
  const { audio, signal, bytes, meta, onPlaybackStart, reason } = opts;
  throwIfAborted(signal);

  const t0 = performance.now();
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: MIME }),
  );

  try {
    audio.src = url;
    try {
      audio.load();
    } catch {
      // ignore
    }
    const played = await tryPlay(audio);
    if (played) {
      onPlaybackStart?.();
    }
    ttsLog("playback.start", {
      mode: "blob_fallback",
      reason,
      msToFirstPlay: Math.round(performance.now() - t0),
      bytes: bytes.length,
      playing: played,
    });
    await waitUntilPlaybackEnds(audio, signal, { detectStall: played });
    ttsLog("playback.done", {
      mode: "blob_fallback",
      msTotal: Math.round(performance.now() - t0),
    });
    return meta;
  } finally {
    URL.revokeObjectURL(url);
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {
      // ignore
    }
  }
}

/**
 * Stream a fetch `Response` body into `audio` via MediaSource.
 */
export async function streamResponseToAudio(opts: {
  res: Response;
  audio: HTMLAudioElement;
  signal: AbortSignal;
  fallbackTextLength: number;
  fallbackVoiceId: string;
  onPlaybackStart?: () => void;
}): Promise<TtsPlaybackMeta> {
  const { res, audio, signal, fallbackTextLength, fallbackVoiceId } = opts;
  throwIfAborted(signal);

  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(json?.error ?? `Premium TTS failed with ${res.status}`);
  }

  const body = res.body;
  if (!body) throw new Error("TTS response had no body");

  const meta = parseMeta(res, fallbackTextLength, fallbackVoiceId);
  const collectedChunks: Uint8Array[] = [];
  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  let sourceBuffer: SourceBuffer | null = null;
  let playStarted = false;
  let handedOffToBlob = false;
  const t0 = performance.now();

  const onAbort = () => {
    void body.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    audio.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onMsError = () => {
        cleanup();
        reject(new Error("MediaSource failed to open"));
      };
      const cleanup = () => {
        mediaSource.removeEventListener("sourceopen", onOpen);
        mediaSource.removeEventListener("error", onMsError);
      };
      mediaSource.addEventListener("sourceopen", onOpen);
      mediaSource.addEventListener("error", onMsError);
    });

    throwIfAborted(signal);
    sourceBuffer = mediaSource.addSourceBuffer(MIME);

    const reader = body.getReader();
    let bytesIn = 0;
    try {
      while (true) {
        throwIfAborted(signal);
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        collectedChunks.push(new Uint8Array(value));
        bytesIn += value.length;

        await appendToSourceBuffer(sourceBuffer, value);

        if (
          !playStarted &&
          bufferedSeconds(sourceBuffer) >= MIN_BUFFER_BEFORE_PLAY_SEC
        ) {
          playStarted = true;
          const played = await tryPlay(audio);
          if (played) {
            opts.onPlaybackStart?.();
          }
          ttsLog("playback.start", {
            mode: "mse",
            msToFirstPlay: Math.round(performance.now() - t0),
            bytesIn,
            playing: played,
          });
        }
      }
    } finally {
      reader.releaseLock();
    }

    throwIfAborted(signal);
    await waitSourceBufferUpdateEnd(sourceBuffer);
    if (mediaSource.readyState === "open") {
      mediaSource.endOfStream();
    }

    if (!playStarted) {
      const played = await tryPlay(audio);
      if (played) {
        opts.onPlaybackStart?.();
      }
      ttsLog("playback.start", {
        mode: "mse",
        msToFirstPlay: 0,
        bytesIn,
        playing: played,
      });
    }

    try {
      await waitUntilPlaybackEnds(audio, signal, { detectStall: true });
      ttsLog("playback.done", {
        mode: "mse",
        msTotal: Math.round(performance.now() - t0),
        bytesIn,
      });
      return meta;
    } catch (err) {
      if (
        err instanceof PlaybackStallError ||
        (err instanceof Error && err.message === "Audio playback failed")
      ) {
        handedOffToBlob = true;
        releaseMediaSource(audio, objectUrl, mediaSource);
        const bytes = concatChunks(collectedChunks);
        return playBytesAsBlob({
          audio,
          signal,
          bytes,
          meta,
          onPlaybackStart: opts.onPlaybackStart,
          reason: err instanceof PlaybackStallError ? "stall" : "mse_error",
        });
      }
      throw err;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!handedOffToBlob) {
      releaseMediaSource(audio, objectUrl, mediaSource);
    }
  }
}

/**
 * Buffer the full response into a blob URL (Safari / no-MSE fallback).
 */
export async function blobResponseToAudio(opts: {
  res: Response;
  audio: HTMLAudioElement;
  signal: AbortSignal;
  fallbackTextLength: number;
  fallbackVoiceId: string;
  onPlaybackStart?: () => void;
}): Promise<TtsPlaybackMeta> {
  const { res, audio, signal, fallbackTextLength, fallbackVoiceId } = opts;
  throwIfAborted(signal);

  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(json?.error ?? `Premium TTS failed with ${res.status}`);
  }

  const t0 = performance.now();
  const blob = await res.blob();
  throwIfAborted(signal);

  const meta = parseMeta(res, fallbackTextLength, fallbackVoiceId);
  const url = URL.createObjectURL(blob);

  try {
    audio.src = url;
    try {
      audio.load();
    } catch {
      // ignore
    }
    const played = await tryPlay(audio);
    if (played) {
      opts.onPlaybackStart?.();
    }
    ttsLog("playback.start", {
      mode: "blob",
      msToFirstPlay: Math.round(performance.now() - t0),
      bytes: blob.size,
      playing: played,
    });
    await waitUntilPlaybackEnds(audio, signal, { detectStall: played });
    ttsLog("playback.done", {
      mode: "blob",
      msTotal: Math.round(performance.now() - t0),
    });
    return meta;
  } finally {
    URL.revokeObjectURL(url);
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {
      // ignore
    }
  }
}

/**
 * Pick streaming or blob playback based on browser capability.
 */
export async function playTtsResponse(opts: {
  res: Response;
  audio: HTMLAudioElement;
  signal: AbortSignal;
  fallbackTextLength: number;
  fallbackVoiceId: string;
  onPlaybackStart?: () => void;
}): Promise<TtsPlaybackMeta> {
  if (isStreamingPlaybackSupported()) {
    return streamResponseToAudio(opts);
  }
  return blobResponseToAudio(opts);
}
