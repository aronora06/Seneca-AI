/**
 * Express entry point. Loads env, mounts middleware, mounts routes, listens.
 * Keep this file thin — feature work lives in src/routes/*.
 */

import "./bootstrap.js";

import cors from "cors";
import express from "express";
import morgan from "morgan";

import { ALL_TOOLS } from "@seneca/shared";

import { env } from "./env.js";
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
  }),
);

// Vision payloads can be a few hundred KB of base64 PNG.
app.use(express.json({ limit: "12mb" }));
app.use(morgan("dev"));

app.use(healthRouter);
app.use(chatRouter);
app.use(sessionsRouter);
app.use(webRouter);
app.use(documentsRouter);
app.use(ttsRouter);

// Default error handler — keeps responses uniform.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api] unhandled error:", message);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal_error", message });
  },
);

app.listen(env.port, () => {
  console.log(
    `[seneca-api] listening on http://localhost:${env.port} (web origin: ${env.webOrigin})`,
  );
  // Boot-time banner so a stale process is obvious at a glance. If you
  // change the tool list and don't see your new names here on the next
  // `pnpm dev` restart, something is wrong with the rebuild / restart
  // cycle (almost always: a previous API process is still holding the
  // port and tsx-watch is stuck in an EADDRINUSE loop).
  const toolNames = ALL_TOOLS.map((t) => t.name).join(", ");
  console.log(
    `[seneca-api] tools loaded (${ALL_TOOLS.length}): ${toolNames}`,
  );
});
