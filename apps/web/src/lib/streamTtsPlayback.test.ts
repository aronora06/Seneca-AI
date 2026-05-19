import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PlaybackStallError,
  blobResponseToAudio,
  isStreamingPlaybackSupported,
  playTtsResponse,
  streamResponseToAudio,
  waitUntilPlaybackEnds,
} from "./streamTtsPlayback";

function createMockAudio(opts?: { stall?: boolean }): HTMLAudioElement & {
  _emit: (type: string) => void;
} {
  const listeners = new Map<string, Set<() => void>>();
  const stall = opts?.stall ?? false;
  const audio = {
    paused: true,
    ended: false,
    currentTime: 0,
    src: "",
    get buffered() {
      if (this.paused && !stall) {
        return { length: 0, end: () => 0, start: () => 0 };
      }
      return {
        length: 1,
        end: () => 10,
        start: () => 0,
      };
    },
    play: vi.fn(async function (this: { paused: boolean; currentTime: number }) {
      this.paused = false;
      if (!stall) this.currentTime = 0.1;
    }),
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
    }),
    removeAttribute: vi.fn(function (this: { src: string }) {
      this.src = "";
    }),
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    _emit(type: string) {
      if (type === "ended") {
        this.ended = true;
        this.currentTime = 10;
      }
      listeners.get(type)?.forEach((fn) => fn());
    },
  };
  return audio as unknown as HTMLAudioElement & { _emit: (type: string) => void };
}

describe("waitUntilPlaybackEnds", () => {
  it("rejects with PlaybackStallError when currentTime never advances", async () => {
    vi.useFakeTimers();
    try {
      const audio = createMockAudio({ stall: true });
      await audio.play();

      const promise = waitUntilPlaybackEnds(
        audio,
        new AbortController().signal,
        { detectStall: true },
      );
      const assertRejected = expect(promise).rejects.toBeInstanceOf(
        PlaybackStallError,
      );
      await vi.advanceTimersByTimeAsync(8_200);
      await assertRejected;
    } finally {
      vi.useRealTimers();
    }
  });
});

function chunkedResponse(chunks: Uint8Array[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "X-Characters": "12",
      "X-Voice-Id": "voice_test",
    },
  });
}

describe("isStreamingPlaybackSupported", () => {
  it("reflects MediaSource + audio/mpeg support", () => {
    expect(typeof isStreamingPlaybackSupported()).toBe("boolean");
  });
});

describe("blobResponseToAudio", () => {
  it("plays a full blob and returns header metadata", async () => {
    const audio = createMockAudio();
    const res = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "X-Characters": "5",
        "X-Voice-Id": "v_blob",
      },
    });

    const playPromise = blobResponseToAudio({
      res,
      audio,
      signal: new AbortController().signal,
      fallbackTextLength: 5,
      fallbackVoiceId: "fallback",
    });

    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    audio._emit("ended");

    const meta = await playPromise;
    expect(meta.characters).toBe(5);
    expect(meta.voiceId).toBe("v_blob");
    expect(audio.play).toHaveBeenCalled();
  });
});

describe("streamResponseToAudio", () => {
  const appended: Uint8Array[] = [];

  beforeEach(() => {
    appended.length = 0;

    class FakeSourceBuffer {
      updating = false;
      private end = 0;
      private listeners = new Map<string, Set<() => void>>();

      appendBuffer(data: Uint8Array) {
        appended.push(data);
        this.updating = true;
        this.end += 0.3;
        queueMicrotask(() => {
          this.updating = false;
          this.listeners.get("updateend")?.forEach((fn) => fn());
        });
      }

      addEventListener(type: string, fn: () => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      }

      removeEventListener(type: string, fn: () => void) {
        this.listeners.get(type)?.delete(fn);
      }

      get buffered() {
        const end = this.end;
        return {
          length: end > 0 ? 1 : 0,
          end: (i: number) => (i === 0 ? end : 0),
        };
      }
    }

    vi.stubGlobal(
      "MediaSource",
      class {
        static isTypeSupported = () => true;
        readyState: "closed" | "open" = "closed";
        private listeners = new Map<string, Set<() => void>>();
        sourceBuffer = new FakeSourceBuffer();

        constructor() {
          queueMicrotask(() => {
            this.readyState = "open";
            this.listeners.get("sourceopen")?.forEach((fn) => fn());
          });
        }

        addEventListener(type: string, fn: () => void) {
          if (!this.listeners.has(type)) this.listeners.set(type, new Set());
          this.listeners.get(type)!.add(fn);
        }

        removeEventListener(type: string, fn: () => void) {
          this.listeners.get(type)?.delete(fn);
        }

        addSourceBuffer(_mime: string) {
          return this.sourceBuffer as unknown as SourceBuffer;
        }

        endOfStream() {
          this.readyState = "closed";
        }
      },
    );

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("appends streamed chunks and starts playback early", async () => {
    const audio = createMockAudio();
    const res = chunkedResponse([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ]);
    const onStart = vi.fn();

    const playPromise = streamResponseToAudio({
      res,
      audio,
      signal: new AbortController().signal,
      fallbackTextLength: 10,
      fallbackVoiceId: "v1",
      onPlaybackStart: onStart,
    });

    await vi.waitFor(() => expect(onStart).toHaveBeenCalled());
    audio._emit("ended");

    const meta = await playPromise;
    expect(meta.characters).toBe(12);
    expect(meta.voiceId).toBe("voice_test");
    expect(appended.length).toBeGreaterThan(0);
  });

  it("aborts mid-stream when signal is aborted", async () => {
    const audio = createMockAudio();
    const controller = new AbortController();
    const res = chunkedResponse([new Uint8Array([1])]);

    const playPromise = streamResponseToAudio({
      res,
      audio,
      signal: controller.signal,
      fallbackTextLength: 1,
      fallbackVoiceId: "v1",
    });

    controller.abort();
    await expect(playPromise).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("playTtsResponse", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses blob fallback when MediaSource is unavailable", async () => {
    vi.stubGlobal("MediaSource", undefined);

    const audio = createMockAudio();
    const res = new Response(new Uint8Array([9]), {
      status: 200,
      headers: { "X-Characters": "1", "X-Voice-Id": "v2" },
    });

    const playPromise = playTtsResponse({
      res,
      audio,
      signal: new AbortController().signal,
      fallbackTextLength: 1,
      fallbackVoiceId: "v2",
    });

    await vi.waitFor(() => expect(audio.play).toHaveBeenCalled());
    audio._emit("ended");

    const meta = await playPromise;
    expect(meta.voiceId).toBe("v2");
    expect(audio.play).toHaveBeenCalled();
  });
});
