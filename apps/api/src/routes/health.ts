import { Router } from "express";

import { env } from "../env.js";

export const healthRouter = Router();

healthRouter.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "seneca-api", ts: new Date().toISOString() });
});

/**
 * Phase F — readiness probe. Distinguishes "process is up" (the
 * liveness check `/api/health`) from "process is configured and
 * ready to serve real traffic". Used by deploy platforms /
 * uptime monitors to decide whether to route requests in. The
 * probe is sync — we don't want to hammer Anthropic with an
 * outbound call from this hot path; instead we just confirm the
 * key is present, since the chat route will surface upstream
 * errors with `code: "upstream_failed"` once a real turn runs.
 *
 * Optional integrations report their state too, so the operator
 * gets a single endpoint to confirm every key is wired up:
 *   - voyage   → semantic doc search vs. substring fallback
 *   - tavily   → web_search vs. 503
 *   - elevenlabs → premium TTS vs. browser-TTS fallback
 *
 * No outbound calls. The probe is intended to be fast (< 1ms).
 */
healthRouter.get("/api/ready", (_req, res) => {
  const anthropicReady = env.anthropicApiKey.length > 0;
  const supabaseReady =
    env.devBypassAuth ||
    (env.supabaseUrl.length > 0 &&
      env.supabaseServiceRoleKey.length > 0 &&
      env.supabaseAnonKey.length > 0);
  const ready = anthropicReady && supabaseReady;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "seneca-api",
    ts: new Date().toISOString(),
    checks: {
      anthropic: anthropicReady,
      supabase: supabaseReady,
      voyage: env.voyageApiKey.length > 0,
      tavily: env.tavilyApiKey.length > 0,
      elevenlabs: env.elevenLabsApiKey.length > 0,
    },
    mode: env.devBypassAuth ? "dev-bypass" : "real-auth",
  });
});
