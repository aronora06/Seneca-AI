/**
 * Phase C — `/api/tts` route tests.
 *
 * Two flavours:
 *   1. ElevenLabs unconfigured → /api/tts/config reports `available:
 *      false`, POST /api/tts returns 503/unconfigured.
 *   2. ElevenLabs configured + happy path → streamSpeech is mocked
 *      with a fake `ReadableStream`, the route forwards bytes through,
 *      and the X-Voice-Id / X-Characters headers land.
 *
 * We swap `streamSpeech` and `isElevenLabsConfigured` via `vi.mock`
 * so the tests never touch the real ElevenLabs API.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Hoisted so `vi.mock` (which is itself hoisted to the top of the
// file) can reference the same instances we use in the tests below.
const { configuredFlag, streamSpeechMock } = vi.hoisted(() => ({
  configuredFlag: { value: true },
  streamSpeechMock: vi.fn(),
}));

vi.mock("../lib/elevenLabsTTS.js", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/elevenLabsTTS.js")>(
      "../lib/elevenLabsTTS.js",
    );
  return {
    ...actual,
    isElevenLabsConfigured: () => configuredFlag.value,
    streamSpeech: streamSpeechMock,
  };
});

import { CURATED_VOICES } from "../lib/elevenLabsTTS.js";
// Late import so the mock takes effect first.
const { ttsRouter } = await import("./tts.js");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(ttsRouter);

let baseUrl = "";
let serverHandle: import("node:http").Server;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      serverHandle = app.listen(0, () => {
        const addr = serverHandle.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      serverHandle.close((err) => (err ? reject(err) : resolve()));
    }),
);

beforeEach(() => {
  streamSpeechMock.mockReset();
  configuredFlag.value = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/tts/config", () => {
  it("reports unavailable when ElevenLabs is unconfigured", async () => {
    configuredFlag.value = false;
    const res = await fetch(`${baseUrl}/api/tts/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      available: boolean;
      defaultVoiceId: string | null;
      voices: Array<{ id: string }>;
    };
    expect(body.available).toBe(false);
    expect(body.defaultVoiceId).toBeNull();
    expect(body.voices).toEqual(CURATED_VOICES);
  });

  it("reports available when ElevenLabs is configured", async () => {
    configuredFlag.value = true;
    const res = await fetch(`${baseUrl}/api/tts/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      available: boolean;
      defaultVoiceId: string | null;
    };
    expect(body.available).toBe(true);
    expect(body.defaultVoiceId).toBe(CURATED_VOICES[0]!.id);
  });
});

describe("POST /api/tts", () => {
  it("returns 400 when text is missing", async () => {
    const res = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 413 when text is over the cap", async () => {
    const res = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
  });

  it("streams audio bytes through with X-Voice-Id and X-Characters headers", async () => {
    streamSpeechMock.mockResolvedValueOnce({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0x11, 0x22, 0x33]));
          controller.close();
        },
      }),
      contentType: "audio/mpeg",
      voiceId: "v_brian",
      characters: 11,
    });

    const res = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello world" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Voice-Id")).toBe("v_brian");
    expect(res.headers.get("X-Characters")).toBe("11");
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0x11, 0x22, 0x33]);
  });

  it("maps TTSError(kind=unconfigured) to a structured 503 the client can branch on", async () => {
    const { TTSError } = await vi.importActual<
      typeof import("../lib/elevenLabsTTS.js")
    >("../lib/elevenLabsTTS.js");
    streamSpeechMock.mockRejectedValueOnce(
      new TTSError(
        "unconfigured",
        "ElevenLabs is not configured. Set ELEVENLABS_API_KEY.",
        503,
      ),
    );

    const res = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { kind?: string };
    expect(body.kind).toBe("unconfigured");
  });
});
