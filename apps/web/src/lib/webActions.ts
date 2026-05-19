/**
 * Coerce + apply functions for the `web_*` tools. The dispatcher routes
 * `web_navigate` / `web_search` calls through here.
 *
 * `web_navigate` flows: dispatcher -> applyWebNavigate -> bridge.navigate
 *   -> POST /api/fetch-page (inside the WebTab) -> iframe.srcdoc.
 * `web_search` flows: dispatcher -> applyWebSearch
 *   -> POST /api/web/search -> bridge.showSearchResults -> overlay.
 */

import type {
  WebNavigateInput,
  WebSearchInput,
  WebSearchResult,
} from "@seneca/shared";

import { ApiError, apiJson } from "./api";
import { getWebApi } from "./webBridge";

const requireWebApi = () => {
  const api = getWebApi();
  if (!api) throw new Error("Web tab is not mounted yet.");
  return api;
};

// ── coercers ────────────────────────────────────────────────────────────────

export function coerceNavigateInput(raw: unknown): WebNavigateInput {
  const obj = requireObject(raw);
  if (typeof obj.url !== "string" || !obj.url.trim()) {
    throw new Error("web_navigate requires a non-empty `url`.");
  }
  const url = obj.url.trim();
  // Cheap pre-check; the server does the canonical validation.
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("URL must start with http:// or https://.");
  }
  return { url };
}

export function coerceSearchInput(raw: unknown): WebSearchInput {
  const obj = requireObject(raw);
  if (typeof obj.query !== "string" || !obj.query.trim()) {
    throw new Error("web_search requires a non-empty `query`.");
  }
  const out: WebSearchInput = { query: obj.query.trim() };
  if (typeof obj.max_results === "number" && Number.isFinite(obj.max_results)) {
    out.max_results = clampMax(obj.max_results);
  }
  return out;
}

// ── apply functions ─────────────────────────────────────────────────────────

export async function applyWebNavigate(input: WebNavigateInput): Promise<void> {
  await requireWebApi().navigate(input.url);
}

export async function applyWebSearch(
  input: WebSearchInput,
): Promise<WebSearchResult[]> {
  const api = requireWebApi();
  let body: { results: WebSearchResult[] };
  try {
    body = await apiJson<{ results: WebSearchResult[] }>("/api/web/search", {
      method: "POST",
      body: { query: input.query, max_results: input.max_results ?? 5 },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      throw new Error(
        "Web search isn't configured. Add TAVILY_API_KEY to apps/api/.env.",
      );
    }
    throw err;
  }
  const results = body.results ?? [];
  api.showSearchResults(input.query, results);
  return results;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function requireObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new Error("Tool input was not an object.");
  }
  return raw as Record<string, unknown>;
}

function clampMax(n: number): number {
  if (n < 1) return 1;
  if (n > 10) return 10;
  return Math.floor(n);
}
