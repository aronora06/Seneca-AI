/**
 * Minimal ElevenLabs text-to-speech client.
 *
 * We hit the streaming endpoint directly with `fetch` for the same
 * reason Tavily and Voyage avoid the SDK: the surface area we need is
 * one POST and the SDK adds a meaningful dependency for very little
 * payoff.
 *
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech-stream
 *
 * Errors map to a typed `TTSError` so the route can decide whether
 * to surface a 503 (unconfigured), 429 (rate-limited), 404 (voice
 * not found), or 502 (upstream blew up).
 */

import { env } from "../env.js";

const TTS_HOST = "https://api.elevenlabs.io";
const REQUEST_TIMEOUT_MS = 30_000;

export type TTSErrorKind =
  | "unconfigured"
  | "rate_limited"
  | "voice_not_found"
  | "upstream_failed";

export class TTSError extends Error {
  readonly kind: TTSErrorKind;
  readonly httpStatus: number;

  constructor(kind: TTSErrorKind, message: string, httpStatus: number) {
    super(message);
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.name = "TTSError";
  }
}

export interface CuratedVoice {
  id: string;
  name: string;
  description: string;
}

/**
 * Six pre-vetted voices the curated picker exposes. We pick a small
 * set of voices from the public Voice Library so the user gets a
 * good experience without scrolling through a thousand options on
 * first visit. The IDs are stable public IDs documented at
 * https://elevenlabs.io/app/voice-library — they remain valid even
 * when the user's plan doesn't have a custom voice set up.
 */
export const CURATED_VOICES: CuratedVoice[] = [
  {
    id: "nPczCjzI2devNBz1zQrb",
    name: "Brian",
    description: "Warm, measured American male; the default Seneca voice.",
  },
  {
    id: "pNInz6obpgDQGcFmaJgB",
    name: "Adam",
    description: "Deep, calm American male; great for long passages.",
  },
  {
    id: "JBFqnCBsd6RMkjVDRZzb",
    name: "George",
    description: "British male, mid-tone, thoughtful pacing.",
  },
  {
    id: "EXAVITQu4vr4xnSDxMaL",
    name: "Sarah",
    description: "Soft American female, gentle and patient.",
  },
  {
    id: "21m00Tcm4TlvDq8ikWAM",
    name: "Rachel",
    description: "Clear American female, slightly higher register.",
  },
  {
    id: "TxGEqnHWrfWFTfGW9XjX",
    name: "Josh",
    description: "Younger American male, bright and conversational.",
  },
];

export function isElevenLabsConfigured(): boolean {
  return Boolean(env.elevenLabsApiKey);
}

export function defaultVoiceId(): string {
  // Prefer the operator-configured voice; otherwise the first curated voice.
  if (env.elevenLabsDefaultVoiceId) return env.elevenLabsDefaultVoiceId;
  return CURATED_VOICES[0]!.id;
}

export interface SynthesiseOpts {
  text: string;
  voiceId?: string;
  /** Output format. ElevenLabs supports mp3, pcm, ulaw, ogg. */
  outputFormat?: "mp3_44100_128" | "mp3_22050_32" | "pcm_16000";
}

export interface SynthesisResult {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  voiceId: string;
  characters: number;
}

/**
 * Streams synthesised audio for `text` using the selected voice. The
 * returned `body` is a ReadableStream the route forwards verbatim to
 * the browser; the route is the only place that closes the upstream
 * connection.
 */
export async function streamSpeech(opts: SynthesiseOpts): Promise<SynthesisResult> {
  if (!env.elevenLabsApiKey) {
    throw new TTSError(
      "unconfigured",
      "ElevenLabs is not configured. Set ELEVENLABS_API_KEY in apps/api/.env. See docs/setup.md.",
      503,
    );
  }

  const text = opts.text.trim();
  if (text.length === 0) {
    throw new TTSError("upstream_failed", "Refusing to synthesise empty text.", 400);
  }

  const voiceId = opts.voiceId?.trim() || defaultVoiceId();
  const outputFormat = opts.outputFormat ?? "mp3_44100_128";

  const url = `${TTS_HOST}/v1/text-to-speech/${encodeURIComponent(
    voiceId,
  )}/stream?output_format=${encodeURIComponent(outputFormat)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": env.elevenLabsApiKey,
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: env.elevenLabsModelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new TTSError("upstream_failed", "ElevenLabs request timed out.", 504);
    }
    throw new TTSError(
      "upstream_failed",
      err instanceof Error ? err.message : String(err),
      502,
    );
  }

  // We intentionally keep the timer alive while streaming — clear it
  // here so a slow but progressing stream doesn't abort itself.
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 404) {
      throw new TTSError(
        "voice_not_found",
        `Voice ${voiceId} not found. Pick another in Settings → Voice.`,
        404,
      );
    }
    if (res.status === 429) {
      throw new TTSError(
        "rate_limited",
        "ElevenLabs rate limit hit. Try again in a minute.",
        429,
      );
    }
    throw new TTSError(
      "upstream_failed",
      `ElevenLabs returned ${res.status}: ${body.slice(0, 200) || "no body"}`,
      502,
    );
  }

  const body = res.body;
  if (!body) {
    throw new TTSError("upstream_failed", "ElevenLabs returned an empty body.", 502);
  }
  const contentType = res.headers.get("content-type") ?? "audio/mpeg";

  return {
    body,
    contentType,
    voiceId,
    characters: countCharsForBilling(text),
  };
}

/**
 * ElevenLabs bills by character. We mirror their counter (everything
 * the API receives) so our usage telemetry agrees with the dashboard
 * to within a few characters.
 */
export function countCharsForBilling(text: string): number {
  return text.length;
}
