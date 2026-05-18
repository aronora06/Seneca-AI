/**
 * Per-million-token USD pricing for the Anthropic models Seneca uses.
 *
 * The numbers below are sourced from Anthropic's public pricing page;
 * they're stable enough day-to-day that hard-coding is fine, and a
 * stale rate just produces a slightly wrong number on the cost pill
 * (not a crash or incorrect billing). Operators can override via the
 * `ANTHROPIC_PRICING_OVERRIDES` env var (JSON, see env.ts) if Anthropic
 * adjusts rates and we haven't pushed an update yet.
 *
 * Pricing units: USD per **million tokens** (Mtok). For a turn that
 * sent 12,000 input tokens and produced 480 output tokens against the
 * default sonnet rate, the input cost is `12_000 / 1_000_000 * 3 = $0.036`
 * and the output cost is `480 / 1_000_000 * 15 = $0.0072`.
 *
 * Cache rates: Anthropic charges 25% of the base input rate for
 * cache-write tokens and 10% for cache-read tokens. We mirror that
 * here so the cost number reported to the UI matches the real bill
 * even when prompt caching is in play.
 */

export interface ModelPricing {
  /** USD per million input tokens (no cache). */
  inputPerMtok: number;
  /** USD per million output tokens. */
  outputPerMtok: number;
  /** USD per million tokens written into the cache (25% of input by default). */
  cacheWritePerMtok: number;
  /** USD per million tokens read from the cache (10% of input by default). */
  cacheReadPerMtok: number;
}

/**
 * Built-in defaults. Keep this list short — only the models we
 * actually ship by default need entries. Anything missing falls back
 * to {@link FALLBACK_PRICING} so unknown models still produce a
 * plausible-but-low estimate rather than NaN.
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // ── Claude Sonnet family ───────────────────────────────────────────
  "claude-sonnet-4-5": withCacheDefaults({ input: 3.0, output: 15.0 }),
  "claude-sonnet-4-6": withCacheDefaults({ input: 3.0, output: 15.0 }),
  "claude-3-5-sonnet-latest": withCacheDefaults({ input: 3.0, output: 15.0 }),
  "claude-3-5-sonnet-20241022": withCacheDefaults({ input: 3.0, output: 15.0 }),

  // ── Claude Opus family ─────────────────────────────────────────────
  "claude-opus-4-7": withCacheDefaults({ input: 15.0, output: 75.0 }),
  "claude-3-opus-latest": withCacheDefaults({ input: 15.0, output: 75.0 }),

  // ── Claude Haiku family ────────────────────────────────────────────
  "claude-haiku-4-5": withCacheDefaults({ input: 0.8, output: 4.0 }),
  "claude-3-5-haiku-latest": withCacheDefaults({ input: 0.8, output: 4.0 }),
};

/** Sensible-but-conservative numbers used when the model id is unknown. */
const FALLBACK_PRICING: ModelPricing = withCacheDefaults({
  input: 3.0,
  output: 15.0,
});

function withCacheDefaults(opts: { input: number; output: number }): ModelPricing {
  return {
    inputPerMtok: opts.input,
    outputPerMtok: opts.output,
    cacheWritePerMtok: opts.input * 1.25,
    cacheReadPerMtok: opts.input * 0.1,
  };
}

/**
 * Look up the price card for a given model id. Falls back to a
 * conservative default and logs once per unknown id so operators know
 * to add an override.
 */
const warnedOnce = new Set<string>();
export function pricingFor(modelId: string): ModelPricing {
  const hit = DEFAULT_PRICING[modelId];
  if (hit) return hit;
  if (!warnedOnce.has(modelId)) {
    warnedOnce.add(modelId);
    console.warn(
      `[seneca] no pricing entry for model "${modelId}"; falling back to default sonnet rates`,
    );
  }
  return FALLBACK_PRICING;
}

/** Pure cost math; exposed so chat.ts can compose it without coupling. */
export function computeCostUSD(
  modelId: string,
  usage: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  },
): { inputCostUSD: number; outputCostUSD: number; totalCostUSD: number } {
  const p = pricingFor(modelId);
  const inputTok = nonNeg(usage.input_tokens);
  const outputTok = nonNeg(usage.output_tokens);
  const cacheReadTok = nonNeg(usage.cache_read_input_tokens);
  const cacheWriteTok = nonNeg(usage.cache_creation_input_tokens);

  const inputCostUSD =
    (inputTok / 1_000_000) * p.inputPerMtok +
    (cacheReadTok / 1_000_000) * p.cacheReadPerMtok +
    (cacheWriteTok / 1_000_000) * p.cacheWritePerMtok;
  const outputCostUSD = (outputTok / 1_000_000) * p.outputPerMtok;

  return {
    inputCostUSD,
    outputCostUSD,
    totalCostUSD: inputCostUSD + outputCostUSD,
  };
}

function nonNeg(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
  return v;
}

export const _internals = {
  DEFAULT_PRICING,
  FALLBACK_PRICING,
};
