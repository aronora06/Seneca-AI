/**
 * Centralized env loader. We keep this in one place so missing variables
 * surface a clear error at boot rather than a confusing runtime crash.
 *
 * Supabase variables are only required when DEV_BYPASS_AUTH is off. In
 * bypass mode we use an in-memory session store and a fixed "dev" user,
 * which lets you run the whole app with just an Anthropic key.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required env var ${name}. Copy apps/api/.env.example to apps/api/.env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

const devBypassAuth = bool("DEV_BYPASS_AUTH", false);

export const env = {
  port: Number(optional("PORT", "8787")),
  webOrigin: optional("WEB_ORIGIN", "http://localhost:5173"),

  devBypassAuth,
  /** Stable fake user id used when devBypassAuth is on. */
  devUserId: optional("DEV_USER_ID", "00000000-0000-0000-0000-000000000001"),
  devUserEmail: optional("DEV_USER_EMAIL", "dev@local"),

  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  anthropicTextModel: optional("ANTHROPIC_TEXT_MODEL", "claude-sonnet-4-6"),
  anthropicVisionModel: optional("ANTHROPIC_VISION_MODEL", "claude-opus-4-7"),

  /**
   * Optional. When set, /api/web/search proxies to Tavily. When empty,
   * the route returns a 503 with a friendly "configure Tavily" message
   * and the rest of the app keeps working — only `web_search` is gated.
   */
  tavilyApiKey: optional("TAVILY_API_KEY", ""),

  /**
   * Optional. When set, document uploads run a chunk-level embedding pass
   * via Voyage AI and `document_search` uses cosine similarity for ranking.
   * When empty, indexing is skipped and `document_search` degrades to the
   * substring fallback — search still works, just less smartly.
   *
   * Anthropic doesn't ship embeddings, so we picked Voyage (their named
   * partner). `voyage-3-large` is the default model; override with
   * `VOYAGE_MODEL` if you want to swap to a cheaper / smaller variant.
   */
  voyageApiKey: optional("VOYAGE_API_KEY", ""),
  voyageModel: optional("VOYAGE_MODEL", "voyage-3-large"),

  /**
   * Optional. When set, `POST /api/tts` streams synthesised audio from
   * ElevenLabs. When empty, the route returns a 503 with a friendly
   * "configure ElevenLabs" payload and the web client silently falls
   * back to the browser's `SpeechSynthesisUtterance` — same graceful
   * pattern Voyage and Tavily already follow.
   *
   * Free tier (10k chars / month) is enough for casual dev. We pin
   * `eleven_turbo_v2_5` because it's the only model that streams
   * sub-second-latency audio at usable quality; override only if you
   * understand the trade-off.
   */
  elevenLabsApiKey: optional("ELEVENLABS_API_KEY", ""),
  elevenLabsDefaultVoiceId: optional("ELEVENLABS_DEFAULT_VOICE_ID", ""),
  elevenLabsModelId: optional("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5"),

  supabaseUrl: devBypassAuth
    ? optional("SUPABASE_URL", "")
    : required("SUPABASE_URL"),
  supabaseAnonKey: devBypassAuth
    ? optional("SUPABASE_ANON_KEY", "")
    : required("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: devBypassAuth
    ? optional("SUPABASE_SERVICE_ROLE_KEY", "")
    : required("SUPABASE_SERVICE_ROLE_KEY"),
} as const;
