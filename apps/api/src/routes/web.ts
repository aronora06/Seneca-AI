/**
 * Routes powering the Web tab:
 *   - POST /api/fetch-page          → sanitised proxy (static engine)
 *   - POST /api/web/search          → Tavily search
 *   - POST /api/web/render          → hybrid renderer (static→headless
 *                                     fallback). Phase E.
 *   - GET  /api/web/render/config   → tiny capability probe
 *
 * Auth-gated unless noted; rate-limited where the upstream cost is
 * non-trivial.
 */

import { Router, type Response } from "express";

import {
  extractTextFromHtml,
  fetchAndSanitise,
  WebProxyError,
} from "../lib/webProxy.js";
import {
  HeadlessRenderError,
  isHeadlessAvailable,
  looksLikeSpaShell,
  renderPage,
  type HeadlessRenderResult,
} from "../lib/headlessRender.js";
import {
  peekHeadlessBudget,
  tryClaimHeadlessRender,
} from "../lib/headlessRateLimit.js";
import {
  searchWeb,
  TavilyNotConfiguredError,
  TavilyRequestError,
} from "../lib/tavily.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

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

/**
 * Capability probe for the WebTab. Unauthenticated because the
 * client wants to fetch it on first load (the login screen probes
 * this to know which engine badges to show). Returns a tiny payload;
 * no secrets leak. `headlessAvailable` only flips true when
 * `playwright-core` is installed AND `chromium.launch()` succeeded
 * at least once; subsequent failures stay sticky-true to avoid
 * pinging the probe on every render.
 */
webRouter.get(
  "/api/web/render/config",
  async (_req, res: Response) => {
    res.json({ headlessAvailable: await isHeadlessAvailable() });
  },
);

/**
 * Hybrid render endpoint. Always tries the cheap sanitised path
 * first; if the result smells like a SPA shell AND headless is
 * available AND the session has render budget left, falls back to
 * Chromium. The response shape uses a tagged union (`engine`) so
 * the client can branch cleanly.
 */
webRouter.post(
  "/api/web/render",
  requireAuth,
  rateLimit("render"),
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const body = (req.body ?? {}) as {
      url?: unknown;
      sessionId?: unknown;
      forceEngine?: unknown;
    };
    if (typeof body.url !== "string" || !body.url.trim()) {
      res.status(400).json({ error: "Body must be { url: string }." });
      return;
    }
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.length > 0
        ? body.sessionId
        : req.user.id;
    const forceEngine =
      body.forceEngine === "static" || body.forceEngine === "headless"
        ? (body.forceEngine as "static" | "headless")
        : null;
    const url = body.url.trim();

    // Try the cheap static path first unless the caller demanded
    // headless. Either way we may need the sanitised HTML to feed
    // the SPA heuristic.
    let staticPage: Awaited<ReturnType<typeof fetchAndSanitise>> | null = null;
    let staticErr: WebProxyError | null = null;
    if (forceEngine !== "headless") {
      try {
        staticPage = await fetchAndSanitise(url);
      } catch (err) {
        if (err instanceof WebProxyError) {
          staticErr = err;
        } else {
          res.status(500).json({
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      }
    }

    const headlessReady = await isHeadlessAvailable();
    const shouldTryHeadless = (() => {
      if (forceEngine === "headless") return true;
      if (forceEngine === "static") return false;
      if (!headlessReady) return false;
      if (staticErr && /non_html|upstream_failed|too_large/.test(staticErr.code)) {
        return false; // headless won't fix wrong-content-type or oversize.
      }
      if (staticErr) return true; // any other static failure → try headless
      if (!staticPage) return false;
      const visible = extractTextFromHtml(staticPage.html, 2_000).text;
      return looksLikeSpaShell({
        rawHtml: staticPage.html,
        visibleText: visible,
      });
    })();

    if (shouldTryHeadless) {
      const claim = tryClaimHeadlessRender(sessionId);
      if (!claim.ok) {
        res.setHeader("Retry-After", String(claim.retryAfterSec));
        res.status(429).json({
          error: "Headless render budget exceeded for this session.",
          code: "rate_limited",
          used: claim.used,
          budget: claim.budget,
        });
        return;
      }
      try {
        const headless: HeadlessRenderResult = await renderPage(url);
        const budget = peekHeadlessBudget(sessionId);
        res.json({
          engine: "headless" as const,
          headless,
          budget,
        });
        return;
      } catch (err) {
        if (err instanceof HeadlessRenderError) {
          // Fall through to the static result if we have one. Else
          // surface the headless error.
          if (staticPage) {
            const budget = peekHeadlessBudget(sessionId);
            res.json({
              engine: "static" as const,
              static: staticPage,
              budget,
              headlessError: {
                code: err.code,
                message: err.message,
              },
            });
            return;
          }
          res.status(err.httpStatus).json({ error: err.message, code: err.code });
          return;
        }
        res
          .status(500)
          .json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
    }

    if (staticPage) {
      const budget = peekHeadlessBudget(sessionId);
      res.json({
        engine: "static" as const,
        static: staticPage,
        budget,
      });
      return;
    }

    // No static, no headless — surface whichever error we have.
    if (staticErr) {
      res
        .status(staticErr.httpStatus)
        .json({ error: staticErr.message, code: staticErr.code });
      return;
    }
    res.status(500).json({ error: "Unable to render page." });
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
