/**
 * Phase E — sliding-window rate limiter for the headless renderer.
 *
 * The limiter sits between the route layer and the expensive
 * Chromium boot. These tests cover the boundary cases that matter:
 *   - first claim succeeds + counter increments
 *   - hitting the budget returns retryAfter + structured "over"
 *   - sessions are isolated
 *   - peek() never mutates
 *   - a custom budget overrides the default
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetHeadlessRateLimitForTests,
  peekHeadlessBudget,
  tryClaimHeadlessRender,
} from "./headlessRateLimit.js";

beforeEach(() => {
  __resetHeadlessRateLimitForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tryClaimHeadlessRender", () => {
  it("accepts the first render and increments the bucket", () => {
    const out = tryClaimHeadlessRender("sess-A");
    expect(out.ok).toBe(true);
    const peek = peekHeadlessBudget("sess-A");
    expect(peek.used).toBe(1);
    expect(peek.budget).toBe(30);
  });

  it("blocks once the budget is exhausted and surfaces a retry-after", () => {
    for (let i = 0; i < 5; i++) {
      const out = tryClaimHeadlessRender("sess-B", 5);
      expect(out.ok).toBe(true);
    }
    const blocked = tryClaimHeadlessRender("sess-B", 5);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.used).toBe(5);
      expect(blocked.budget).toBe(5);
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
      // Retry-After is the gap until the oldest entry expires; with
      // a 1h window and an entry placed now, it's near 3600s.
      expect(blocked.retryAfterSec).toBeLessThanOrEqual(3_600);
    }
  });

  it("isolates buckets across sessions", () => {
    tryClaimHeadlessRender("sess-1", 2);
    tryClaimHeadlessRender("sess-1", 2);
    const blocked = tryClaimHeadlessRender("sess-1", 2);
    expect(blocked.ok).toBe(false);
    // A different session still has full budget.
    const fresh = tryClaimHeadlessRender("sess-2", 2);
    expect(fresh.ok).toBe(true);
  });

  it("recovers once the window expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0));
    for (let i = 0; i < 3; i++) tryClaimHeadlessRender("sess-X", 3);
    expect(tryClaimHeadlessRender("sess-X", 3).ok).toBe(false);
    // Advance past the 1-hour window.
    vi.setSystemTime(new Date(2024, 0, 1, 13, 5, 0));
    expect(tryClaimHeadlessRender("sess-X", 3).ok).toBe(true);
  });

  it("peek() never mutates the bucket", () => {
    tryClaimHeadlessRender("sess-Y");
    const before = peekHeadlessBudget("sess-Y").used;
    peekHeadlessBudget("sess-Y");
    peekHeadlessBudget("sess-Y");
    expect(peekHeadlessBudget("sess-Y").used).toBe(before);
  });

  it("peek() on an unknown session reports an empty bucket", () => {
    const peek = peekHeadlessBudget("never-touched");
    expect(peek.used).toBe(0);
    expect(peek.budget).toBe(30);
    expect(peek.resetInMs).toBe(0);
  });
});
