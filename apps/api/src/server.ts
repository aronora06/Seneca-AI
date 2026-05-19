/**
 * Express entry point. Loads env, mounts middleware, mounts routes, listens.
 * Keep this file thin — feature work lives in src/routes/*.
 */

import "./bootstrap.js";

import cors from "cors";
import express from "express";

import { ALL_TOOLS } from "@seneca/shared";

import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { requestId, type RequestWithMeta } from "./middleware/requestId.js";
import { chatRouter } from "./routes/chat.js";
import { documentsRouter } from "./routes/documents.js";
import { healthRouter } from "./routes/health.js";
import { sessionsRouter } from "./routes/sessions.js";
import { ttsRouter } from "./routes/tts.js";
import { webRouter } from "./routes/web.js";

const app = express();

app.use(
  cors({
    origin: env.webOrigin,
    credentials: true,
    exposedHeaders: ["X-Request-Id", "Retry-After"],
  }),
);

// Vision payloads can be a few hundred KB of base64 PNG.
app.use(express.json({ limit: "12mb" }));
app.use(requestId);

// Phase F — replace `morgan("dev")` with a single structured log
// line per request. The line includes the request ID we stamped
// above so an operator can correlate request → handler → upstream
// error.
app.use((req: RequestWithMeta, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const status = res.statusCode;
    const durationMs = Date.now() - start;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    (req.log ?? logger)[level](
      {
        method: req.method,
        path: req.path,
        status,
        durationMs,
      },
      "request",
    );
  });
  next();
});

app.use(healthRouter);
app.use(chatRouter);
app.use(sessionsRouter);
app.use(webRouter);
app.use(documentsRouter);
app.use(ttsRouter);

// Default error handler — keeps responses uniform and logs the
// unhandled error with the request ID for cross-referencing.
app.use(
  (
    err: unknown,
    req: RequestWithMeta,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = err instanceof Error ? err.message : String(err);
    (req.log ?? logger).error(
      { err: err instanceof Error ? err.stack : String(err) },
      "unhandled error",
    );
    if (res.headersSent) return;
    res.status(500).json({
      error: "internal_error",
      message,
      requestId: req.requestId,
    });
  },
);

app.listen(env.port, () => {
  // Boot-time banner so a stale process is obvious at a glance. If
  // you change the tool list and don't see your new names here on
  // the next `pnpm dev` restart, something is wrong with the
  // rebuild / restart cycle (almost always: a previous API process
  // is still holding the port and tsx-watch is stuck in an
  // EADDRINUSE loop).
  const toolNames = ALL_TOOLS.map((t) => t.name).join(", ");
  logger.info(
    {
      port: env.port,
      webOrigin: env.webOrigin,
      toolCount: ALL_TOOLS.length,
      tools: toolNames,
      rateLimitTurnsPerHour: env.rateLimitTurnsPerHour,
      costCapUsdPerDay: env.costCapUsdPerDay,
      devBypassAuth: env.devBypassAuth,
    },
    `seneca-api listening on http://localhost:${env.port}`,
  );
});
