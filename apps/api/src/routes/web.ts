/**
 * Routes powering the Web tab:
 *   - POST /api/fetch-page   → sanitised proxy
 *   - POST /api/web/search   → Tavily search
 *
 * Both behind requireAuth so they aren't exposed to anonymous abuse.
 */

import { Router, type Response } from "express";

import { fetchAndSanitise, WebProxyError } from "../lib/webProxy.js";
import {
  searchWeb,
  TavilyNotConfiguredError,
  TavilyRequestError,
} from "../lib/tavily.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const webRouter = Router();

webRouter.post(
  "/api/fetch-page",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const body = (req.body ?? {}) as { url?: unknown };
    if (typeof body.url !== "string" || !body.url.trim()) {
      res.status(400).json({ error: "Body must be { url: string }." });
      return;
    }
    try {
      const page = await fetchAndSanitise(body.url.trim());
      res.json(page);
    } catch (err) {
      if (err instanceof WebProxyError) {
        res
          .status(err.httpStatus)
          .json({ error: err.message, code: err.code });
        return;
      }
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

webRouter.post(
  "/api/web/search",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    const body = (req.body ?? {}) as {
      query?: unknown;
      max_results?: unknown;
    };
    if (typeof body.query !== "string" || !body.query.trim()) {
      res.status(400).json({ error: "Body must be { query: string }." });
      return;
    }
    const maxResults =
      typeof body.max_results === "number" ? body.max_results : undefined;
    try {
      const results = await searchWeb(body.query.trim(), maxResults);
      res.json({ results });
    } catch (err) {
      if (err instanceof TavilyNotConfiguredError) {
        res.status(503).json({ error: err.message, code: "tavily_missing" });
        return;
      }
      if (err instanceof TavilyRequestError) {
        res
          .status(err.httpStatus >= 400 && err.httpStatus < 600 ? err.httpStatus : 502)
          .json({ error: err.message, code: "tavily_failed" });
        return;
      }
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);
