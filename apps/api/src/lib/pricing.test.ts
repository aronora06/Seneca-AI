import { describe, expect, it } from "vitest";

import { computeCostUSD, pricingFor, _internals } from "./pricing.js";

describe("pricingFor", () => {
  it("returns the configured rate for a known model", () => {
    const p = pricingFor("claude-sonnet-4-5");
    expect(p.inputPerMtok).toBe(3.0);
    expect(p.outputPerMtok).toBe(15.0);
  });

  it("falls back to the conservative rate for unknown models", () => {
    const p = pricingFor("some-future-model");
    expect(p).toEqual(_internals.FALLBACK_PRICING);
  });

  it("derives sensible cache rates from the input rate", () => {
    const p = pricingFor("claude-sonnet-4-5");
    expect(p.cacheReadPerMtok).toBeCloseTo(3.0 * 0.1);
    expect(p.cacheWritePerMtok).toBeCloseTo(3.0 * 1.25);
  });
});

describe("computeCostUSD", () => {
  it("returns zero for an empty usage object", () => {
    expect(computeCostUSD("claude-sonnet-4-5", {})).toEqual({
      inputCostUSD: 0,
      outputCostUSD: 0,
      totalCostUSD: 0,
    });
  });

  it("computes input + output cost", () => {
    const r = computeCostUSD("claude-sonnet-4-5", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(r.inputCostUSD).toBeCloseTo(3.0);
    expect(r.outputCostUSD).toBeCloseTo(15.0);
    expect(r.totalCostUSD).toBeCloseTo(18.0);
  });

  it("layers cache-read + cache-write costs into the input total", () => {
    const r = computeCostUSD("claude-sonnet-4-5", {
      input_tokens: 100_000,
      output_tokens: 0,
      cache_read_input_tokens: 100_000,
      cache_creation_input_tokens: 100_000,
    });
    // 100k base @ $3/Mtok = $0.30
    // 100k cache read @ $0.30/Mtok = $0.03
    // 100k cache write @ $3.75/Mtok = $0.375
    expect(r.inputCostUSD).toBeCloseTo(0.3 + 0.03 + 0.375);
  });

  it("tolerates null / NaN / negative usage values", () => {
    const r = computeCostUSD("claude-sonnet-4-5", {
      input_tokens: -5,
      output_tokens: Number.NaN,
      cache_read_input_tokens: null,
      cache_creation_input_tokens: undefined,
    });
    expect(r.inputCostUSD).toBe(0);
    expect(r.outputCostUSD).toBe(0);
    expect(r.totalCostUSD).toBe(0);
  });

  it("uses the higher Opus rate when the model demands it", () => {
    const r = computeCostUSD("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(r.inputCostUSD).toBeCloseTo(15.0);
    expect(r.outputCostUSD).toBeCloseTo(75.0);
  });
});
