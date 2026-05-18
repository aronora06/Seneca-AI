/**
 * Minimal Tavily client. We use plain `fetch` because the surface area
 * we need is one POST and the SDK adds a meaningful dependency for very
 * little payoff.
 *
 * Tavily docs: https://docs.tavily.com/docs/rest-api/api-reference
 */

import type { WebSearchResult } from "@seneca/shared";

import { env } from "../env.js";

const TAVILY_URL = "https://api.tavily.com/search";
const SEARCH_TIMEOUT_MS = 8_000;

export class TavilyNotConfiguredError extends Error {
  constructor() {
    super(
      "Web search is not configured. Add TAVILY_API_KEY to apps/api/.env. See docs/setup.md.",
    );
    this.name = "TavilyNotConfiguredError";
  }
}

export class TavilyRequestError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.httpStatus = httpStatus;
    this.name = "TavilyRequestError";
  }
}

interface TavilyApiResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyApiResponse {
  results?: TavilyApiResult[];
  answer?: string;
}

export async function searchWeb(
  query: string,
  maxResults = 5,
): Promise<WebSearchResult[]> {
  if (!env.tavilyApiKey) {
    throw new TavilyNotConfiguredError();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(TAVILY_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.tavilyApiKey,
        query,
        max_results: clampMaxResults(maxResults),
        include_answer: false,
        search_depth: "basic",
      }),
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new TavilyRequestError("Tavily timed out.", 504);
    }
    throw new TavilyRequestError(
      err instanceof Error ? err.message : String(err),
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TavilyRequestError(
      `Tavily returned ${res.status}: ${body.slice(0, 200) || "no body"}`,
      res.status,
    );
  }

  const json = (await res.json().catch(() => null)) as TavilyApiResponse | null;
  const results = Array.isArray(json?.results) ? json!.results! : [];

  return results
    .map((r): WebSearchResult | null => {
      const url = typeof r.url === "string" ? r.url : null;
      const title = typeof r.title === "string" ? r.title : null;
      if (!url || !title) return null;
      return {
        title: title.trim(),
        url,
        snippet: typeof r.content === "string" ? r.content.trim() : "",
      };
    })
    .filter((r): r is WebSearchResult => r !== null);
}

function clampMaxResults(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 5;
  if (v < 1) return 1;
  if (v > 10) return 10;
  return Math.floor(v);
}
