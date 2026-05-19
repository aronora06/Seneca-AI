/**
 * Phase C — `/api/tts` premium voice synthesis.
 *
 * Streams audio bytes from ElevenLabs straight through to the browser
 * without buffering. When `ELEVENLABS_API_KEY` is unset, returns a
 * structured 503 the client uses to fall back to the browser's
 * `SpeechSynthesisUtterance`.
 *
 *   POST /api/tts
 *   body: { text: string; voiceId?: string; sessionId?: string }
 *
 * Successful response:
 *   200 OK
 *   Content-Type: audio/mpeg
 *   X-Voice-Id: <id>
 *   X-Characters: <n>          (so the client can debit cost telemetry)
 *
 * Errors map to JSON `{ error, kind }` with kinds matching `TTSError`:
 *   - "unconfigured"     → 503
 *   - "rate_limited"     → 429
 *   - "voice_not_found"  → 404
 *   - "upstream_failed"  → 502
 *
 * Also exposes a tiny `GET /api/tts/config` that the client reads once
 * on boot to decide whether to enable the premium path — beats trying
 * a synth and falling back on every utterance.
 */
import { Router, type Response } from "express";

import { ELEVENLABS_USD_PER_CHAR } from "@seneca/shared";

import {
  CURATED_VOICES,
  TTSError,
  defaultVoiceId,
  isElevenLabsConfigured,
  streamSpeech,
} from "../lib/elevenLabsTTS.js";
import { env } from "../env.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { sessionStore } from "../lib/sessionStore.js";

export const ttsRouter = Router();

/**
 * Feature-flag endpoint. Cheap; no auth so the login page can render
 * without an unnecessary 401.
 */
ttsRouter.get("/api/tts/config", (_req, res) => {
  res.json({
    available: isElevenLabsConfigured(),
    defaultVoiceId: isElevenLabsConfigured() ? defaultVoiceId() : null,
    modelId: isElevenLabsConfigured() ? env.elevenLabsModelId : null,
    voices: CURATED_VOICES,
  });
});

ttsRouter.post(
  "/api/tts",
  requireAuth,
  rateLimit("tts"),
  async (req: AuthedRequest, res) => {
  const body = req.body as
    | { text?: unknown; voiceId?: unknown; sessionId?: unknown }
    | undefined;
  const text = typeof body?.text === "string" ? body.text : "";
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId : undefined;
  const sessionId =
    typeof body?.sessionId === "string" && body.sessionId.length > 0
      ? body.sessionId
      : undefined;

  if (!text.trim()) {
    res.status(400).json({ error: "missing_text" });
    return;
  }
  // Cap input length to keep accidental usage spikes off the bill.
  // ElevenLabs charges per character; 4_000 chars is ~30s of audio.
  if (text.length > 4_000) {
    res.status(413).json({ error: "text_too_long", maxChars: 4000 });
    return;
  }

  try {
    const result = await streamSpeech({ text, voiceId });

    res.status(200);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("X-Voice-Id", result.voiceId);
    res.setHeader("X-Characters", String(result.characters));
    res.setHeader("Cache-Control", "no-store");

    // Stream the upstream body through to the client.
    const reader = result.body.getReader();

    // Detach the connection if the client disconnects mid-stream so we
    // stop pulling from ElevenLabs (and stop billing) immediately.
    let clientGone = false;
    req.on("close", () => {
      clientGone = true;
      try {
        void reader.cancel();
      } catch {
        // ignore
      }
    });

    await pumpStream(reader, res, () => clientGone);

    // Best-effort usage credit. We do this after the stream ends so a
    // mid-stream client disconnect still bills for what got delivered.
    if (sessionId && !clientGone && req.user) {
      try {
        await sessionStore.bumpUsage(sessionId, req.user.id, req.jwt, {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          inputCostUSD: 0,
          outputCostUSD: 0,
          ttsCharacters: result.characters,
          ttsCostUSD: result.characters * ELEVENLABS_USD_PER_CHAR,
        });
      } catch (err) {
        console.warn(
          "[seneca] failed to record TTS usage:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } catch (err) {
    if (err instanceof TTSError) {
      res.status(err.httpStatus).json({
        error: err.message,
        kind: err.kind,
      });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message, kind: "upstream_failed" });
  }
},
);

async function pumpStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  res: Response,
  isCancelled: () => boolean,
): Promise<void> {
  try {
    while (!isCancelled()) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const ok = res.write(value);
      if (!ok && !isCancelled()) {
        await new Promise<void>((resolve) => {
          res.once("drain", resolve);
        });
      }
    }
  } catch {
    // Connection closed mid-stream; just stop.
  } finally {
    try {
      res.end();
    } catch {
      // already ended
    }
  }
}
