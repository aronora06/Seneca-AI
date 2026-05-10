/**
 * Express entry point. Loads env, mounts middleware, mounts routes, listens.
 * Keep this file thin — feature work lives in src/routes/*.
 */

import "./bootstrap.js";

import cors from "cors";
import express from "express";
import morgan from "morgan";

import { env } from "./env.js";
import { chatRouter } from "./routes/chat.js";
import { healthRouter } from "./routes/health.js";
import { sessionsRouter } from "./routes/sessions.js";

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
});
