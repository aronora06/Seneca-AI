/**
 * Phase E — in-memory per-session rate limiter for the headless
 * renderer. Stops a runaway agent from chewing through the
 * Chromium budget by capping headless renders per session per hour.
 *
 * The full per-user rate-limit middleware lands in Phase F; this
 * module is intentionally minimal so we don't grow the route layer
 * past what we need today. Each session tracks a sliding-window
 * counter of timestamps; old entries time out naturally.
 *
 * `peek()` returns the budget without mutating, which the client
 * uses to render the "30 renders this hour" pill.
 */

const WINDOW_MS = 60 * 60 * 1_000;
const DEFAULT_BUDGET = 30;

interface Bucket {
  /** Timestamps of recent renders, oldest first. */
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitState {
  used: number;
  budget: number;
  /** Milliseconds until the oldest entry falls out of the window. */
  resetInMs: number;
}

export function peekHeadlessBudget(
  sessionId: string,
  budget = DEFAULT_BUDGET,
): RateLimitState {
  const bucket = buckets.get(sessionId);
  if (!bucket) return { used: 0, budget, resetInMs: 0 };
  prune(bucket);
  const used = bucket.timestamps.length;
  const oldest = bucket.timestamps[0];
  const resetInMs = oldest ? Math.max(0, WINDOW_MS - (Date.now() - oldest)) : 0;
  return { used, budget, resetInMs };
}

/**
 * Try to claim one render. Returns `null` on success, or a structured
 * "over budget" object the route can map to a 429.
 */
export function tryClaimHeadlessRender(
  sessionId: string,
  budget = DEFAULT_BUDGET,
): { ok: true } | { ok: false; retryAfterSec: number; used: number; budget: number } {
  const bucket = buckets.get(sessionId) ?? { timestamps: [] };
  prune(bucket);
  if (bucket.timestamps.length >= budget) {
    const oldest = bucket.timestamps[0] ?? Date.now();
    const retryAfterSec = Math.max(
      1,
      Math.ceil((WINDOW_MS - (Date.now() - oldest)) / 1_000),
    );
    return {
      ok: false,
      retryAfterSec,
      used: bucket.timestamps.length,
      budget,
    };
  }
  bucket.timestamps.push(Date.now());
  buckets.set(sessionId, bucket);
  return { ok: true };
}

function prune(bucket: Bucket): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (bucket.timestamps.length > 0 && bucket.timestamps[0]! < cutoff) {
    bucket.timestamps.shift();
  }
}

/** Test helper — wipe all buckets between cases. */
export function __resetHeadlessRateLimitForTests(): void {
  buckets.clear();
}
