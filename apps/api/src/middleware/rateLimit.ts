/**
 * Phase F — per-user sliding-window rate limit.
 *
 * Used on the four expensive routes:
 *   - POST /api/chat      (Anthropic token spend)
 *   - POST /api/vision    (Anthropic vision spend)
 *   - POST /api/tts       (ElevenLabs character spend)
 *   - POST /api/web/render (headless Chromium boot cost)
 *
 * The window is 1 hour and the per-route budget defaults to the
 * value of `env.rateLimitTurnsPerHour` scaled by a per-route
 * multiplier (`{ chat: 1, vision: 1, tts: 2, render: 0.5 }`). The
 * limiter is in-process and per-user. A real production deploy
 * (multi-instance, behind a load balancer) would want a Redis-backed
 * limiter; the in-memory one is honest about its scope and is enough
 * for a single-instance Railway-style host.
 *
 * Setting `env.rateLimitTurnsPerHour` to 0 disables the limit
 * entirely — useful in unit tests.
 */

import type { NextFunction, Response } from "express";

import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import type { AuthedRequest } from "./auth.js";

const WINDOW_MS = 60 * 60 * 1_000;

export type RateLimitRoute = "chat" | "vision" | "tts" | "render";

const ROUTE_MULTIPLIERS: Record<RateLimitRoute, number> = {
  chat: 1,
  vision: 1,
  tts: 2,
  render: 0.5,
};

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

/**
 * Express middleware factory. Returns a `RequestHandler` that
 * counts one event against the caller's per-route bucket and, when
 * the bucket is over budget, responds 429 with a `Retry-After`
 * header. The handler is a no-op when `env.rateLimitTurnsPerHour`
 * is 0.
 */
export function rateLimit(route: RateLimitRoute) {
  return function rateLimitHandler(
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ): void {
    if (env.rateLimitTurnsPerHour <= 0) {
      next();
      return;
    }
    if (!req.user) {
      // Auth middleware should already have rejected unauthenticated
      // requests; bail out conservatively if it didn't.
      res.status(401).end();
      return;
    }
    const budget = Math.max(
      1,
      Math.round(env.rateLimitTurnsPerHour * ROUTE_MULTIPLIERS[route]),
    );
    const key = `${route}:${req.user.id}`;
    const bucket = buckets.get(key) ?? { timestamps: [] };
    prune(bucket);
    if (bucket.timestamps.length >= budget) {
      const oldest = bucket.timestamps[0] ?? Date.now();
      const retryAfterSec = Math.max(
        1,
        Math.ceil((WINDOW_MS - (Date.now() - oldest)) / 1_000),
      );
      logger.warn(
        {
          route,
          userId: req.user.id,
          used: bucket.timestamps.length,
          budget,
          retryAfterSec,
        },
        "rate limit exceeded",
      );
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        error: `Rate limit exceeded on ${route}. Try again in ${retryAfterSec}s.`,
        code: "rate_limited",
        used: bucket.timestamps.length,
        budget,
        retryAfterSec,
      });
      return;
    }
    bucket.timestamps.push(Date.now());
    buckets.set(key, bucket);
    next();
  };
}

function prune(bucket: Bucket): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (bucket.timestamps.length > 0 && bucket.timestamps[0]! < cutoff) {
    bucket.timestamps.shift();
  }
}

/** Test helper — wipe all buckets between cases. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
