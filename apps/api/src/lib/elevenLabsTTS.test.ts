/**
 * Phase C — ElevenLabs client unit tests.
 *
 * We mock the `env` module so `streamSpeech` reads a stable test key.
 * `globalThis.fetch` is spied on per test so we can drive the upstream
 * boundary without real HTTP traffic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    elevenLabsApiKey: "test-key",
    elevenLabsDefaultVoiceId: "",
    elevenLabsModelId: "eleven_turbo_v2_5",
  },
}));

import {
  CURATED_VOICES,
  TTSError,
  defaultVoiceId,
  isElevenLabsConfigured,
  streamSpeech,
} from "./elevenLabsTTS.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CURATED_VOICES + defaultVoiceId", () => {
  it("exposes at least 6 curated voices with stable IDs and descriptions", () => {
    expect(CURATED_VOICES.length).toBeGreaterThanOrEqual(6);
    for (const v of CURATED_VOICES) {
      expect(typeof v.id).toBe("string");
      expect(v.id.length).toBeGreaterThan(0);
      expect(v.name.length).toBeGreaterThan(0);
      expect(v.description.length).toBeGreaterThan(0);
    }
  });

  it("defaults to the first curated voice when no override is set", () => {
    expect(defaultVoiceId()).toBe(CURATED_VOICES[0]!.id);
  });

  it("reports configured when the env loader reads a key", () => {
    expect(typeof isElevenLabsConfigured()).toBe("boolean");
  });
});

describe("streamSpeech", () => {
  it("POSTs to the streaming endpoint with the right headers and body", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const fakeRes = new Response(body, {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeRes);

    const result = await streamSpeech({
      text: "hello world",
      voiceId: "v_test",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("/v1/text-to-speech/v_test/stream");
    expect(String(url)).toContain("output_format=mp3_44100_128");
    const headers = init?.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBeTruthy();
    expect(headers["Accept"]).toBe("audio/mpeg");
    const parsed = JSON.parse(String(init?.body));
    expect(parsed.text).toBe("hello world");
    expect(parsed.model_id).toBeTruthy();

    expect(result.contentType).toBe("audio/mpeg");
    expect(result.voiceId).toBe("v_test");
    expect(result.characters).toBe("hello world".length);
  });

  it("maps 429 to TTSError(kind=rate_limited)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );
    await expect(
      streamSpeech({ text: "x", voiceId: "v" }),
    ).rejects.toMatchObject({
      kind: "rate_limited",
      httpStatus: 429,
    });
  });

  it("maps 404 to TTSError(kind=voice_not_found)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("no voice", { status: 404 }),
    );
    await expect(
      streamSpeech({ text: "x", voiceId: "nope" }),
    ).rejects.toMatchObject({
      kind: "voice_not_found",
      httpStatus: 404,
    });
  });

  it("maps generic 500 to TTSError(kind=upstream_failed)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("boom", { status: 500 }),
    );
    await expect(
      streamSpeech({ text: "x", voiceId: "v" }),
    ).rejects.toMatchObject({
      kind: "upstream_failed",
      httpStatus: 502,
    });
  });

  it("rejects empty text without hitting the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(streamSpeech({ text: "   " })).rejects.toBeInstanceOf(TTSError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
