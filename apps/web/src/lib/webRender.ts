/**
 * Phase E — typed client for the hybrid `/api/web/render` endpoint.
 *
 * The server returns one of two engine-specific shapes, keyed by an
 * `engine` discriminator. This module hides the wire shape behind a
 * `RenderResult` union so the WebTab can `switch` on engine cleanly.
 *
 * Capability probe: `fetchRenderConfig()` is cached for the session.
 * It tells the WebTab whether the "Live engine" toggle is even
 * available — when Playwright isn't installed server-side, the
 * toggle is hidden and only the static engine runs.
 */

import { apiJson } from "./api";

export interface HeadlessLink {
  href: string;
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface HeadlessPayload {
  screenshot: string;
  finalUrl: string;
  title: string | null;
  links: HeadlessLink[];
  readerText: string;
  viewport: { width: number; height: number };
}

export interface StaticPayload {
  html: string;
  finalUrl: string;
  title: string | null;
  status: number;
}

export interface RenderBudget {
  used: number;
  budget: number;
  /** Milliseconds until the oldest entry in the budget window expires. */
  resetInMs: number;
}

export type RenderResult =
  | {
      engine: "static";
      static: StaticPayload;
      budget?: RenderBudget;
      headlessError?: { code: string; message: string };
    }
  | {
      engine: "headless";
      headless: HeadlessPayload;
      budget?: RenderBudget;
    };

export interface RenderRequestOptions {
  signal?: AbortSignal;
  /**
   * Force a specific engine. Use sparingly — the server's hybrid
   * resolver normally picks the right one. Useful for a "View as
   * live" manual override.
   */
  forceEngine?: "static" | "headless";
  /** Session id so the per-session budget tracks correctly. */
  sessionId?: string;
}

export async function renderWebPage(
  url: string,
  opts: RenderRequestOptions = {},
): Promise<RenderResult> {
  return apiJson<RenderResult>("/api/web/render", {
    method: "POST",
    body: {
      url,
      forceEngine: opts.forceEngine,
      sessionId: opts.sessionId,
    },
    signal: opts.signal,
  });
}

// ── capability probe ───────────────────────────────────────────────────────

interface RenderConfig {
  headlessAvailable: boolean;
}

let configCache: RenderConfig | null = null;
let inFlight: Promise<RenderConfig> | null = null;

export async function fetchRenderConfig(
  opts: { force?: boolean } = {},
): Promise<RenderConfig> {
  if (!opts.force && configCache) return configCache;
  if (inFlight) return inFlight;
  inFlight = apiJson<RenderConfig>("/api/web/render/config").then(
    (cfg) => {
      configCache = cfg;
      inFlight = null;
      return cfg;
    },
    (err) => {
      inFlight = null;
      configCache = { headlessAvailable: false };
      console.warn("[seneca] /api/web/render/config probe failed", err);
      return configCache;
    },
  );
  return inFlight;
}

/** Drop the cached probe; only used by tests. */
export function __resetRenderConfigForTests(): void {
  configCache = null;
  inFlight = null;
}
