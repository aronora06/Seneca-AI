/**
 * Phase F — stamp every request with a stable request ID and a
 * per-request child logger. The ID also goes back to the client as
 * `X-Request-Id` so a user reporting an issue can paste it for the
 * operator to grep.
 *
 * Honour the inbound `X-Request-Id` header when present (Railway,
 * Cloudflare, Fly all forward one) so a request can be traced
 * across the edge proxy and the API.
 */

import type { NextFunction, Request, Response } from "express";

import { logger, type LoggerLike } from "../lib/logger.js";

export interface RequestWithMeta extends Request {
  requestId?: string;
  log?: LoggerLike;
}

export function requestId(
  req: RequestWithMeta,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header("x-request-id");
  const id =
    (incoming && incoming.trim()) ||
    (globalThis.crypto?.randomUUID?.() ?? fallbackUuid());
  req.requestId = id;
  req.log = logger.child({ requestId: id, route: req.path, method: req.method });
  res.setHeader("X-Request-Id", id);
  next();
}

function fallbackUuid(): string {
  // RFC4122-ish v4 generator for very old Node versions that don't
  // ship `crypto.randomUUID`. Practically Node 19+ has it natively.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
