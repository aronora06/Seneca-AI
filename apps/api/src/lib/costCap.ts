/**
 * Phase F — per-user per-day USD cost cap.
 *
 * Anthropic's bill is the largest chunk of Seneca's variable cost.
 * The cap protects a deployed instance from a runaway agent loop
 * burning through a credit card overnight: when the accumulated
 * spend in the current UTC day crosses `env.costCapUsdPerDay`, the
 * next chat turn refuses to start and returns 403 with
 * `code: "cost_capped"`.
 *
 * We track the spend in-process, keyed by (userId, UTC date). It's
 * advisory — a multi-instance deployment would want a Redis-backed
 * accumulator. For the single-instance Railway deploy this is
 * intended for, in-memory is honest about its scope and the worst
 * case is the cap drifts a few cents on instance restart.
 *
 * The accumulator is fed from the same usage events that already
 * flow through `sessionStore.bumpUsage`; the cost-cap layer is the
 * caller's responsibility to invoke (currently from the chat
 * route's usage handler).
 */

import { env } from "../env.js";

interface DailyBucket {
  /** UTC ISO date (YYYY-MM-DD). */
  day: string;
  /** Accumulated USD spend in this day. */
  usd: number;
}

const buckets = new Map<string, DailyBucket>();

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export interface CostCapState {
  used: number;
  cap: number;
  /** Seconds until midnight UTC. */
  resetInSec: number;
  /** True if the user has already exceeded their daily cap. */
  exceeded: boolean;
}

export function peekDailyCost(userId: string): CostCapState {
  const day = utcDay();
  const bucket = buckets.get(userId);
  const used = bucket && bucket.day === day ? bucket.usd : 0;
  const cap = env.costCapUsdPerDay;
  return {
    used,
    cap,
    resetInSec: secondsUntilMidnightUtc(),
    exceeded: cap > 0 && used >= cap,
  };
}

export function recordDailyCost(userId: string, deltaUSD: number): void {
  if (!Number.isFinite(deltaUSD) || deltaUSD <= 0) return;
  const day = utcDay();
  const bucket = buckets.get(userId);
  if (!bucket || bucket.day !== day) {
    buckets.set(userId, { day, usd: deltaUSD });
    return;
  }
  bucket.usd += deltaUSD;
}

/**
 * Throws a tagged error the chat route maps to a 403 + structured
 * body. Caller is expected to invoke this at the START of a turn so
 * we never start work that the user can't pay for.
 */
export function assertWithinDailyCap(userId: string): void {
  const state = peekDailyCost(userId);
  if (!state.exceeded) return;
  const err = new Error(
    `Daily cost cap of $${state.cap.toFixed(2)} reached. Resets in ${state.resetInSec}s.`,
  );
  (err as Error & { code?: string; httpStatus?: number; state?: CostCapState }).code =
    "cost_capped";
  (err as Error & { httpStatus?: number }).httpStatus = 403;
  (err as Error & { state?: CostCapState }).state = state;
  throw err;
}

function secondsUntilMidnightUtc(): number {
  const now = new Date();
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(0, Math.floor((midnight - now.getTime()) / 1_000));
}

/** Test helper — wipe all buckets between cases. */
export function __resetCostCapForTests(): void {
  buckets.clear();
}
