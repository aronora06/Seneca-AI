import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";
import { supabaseAdmin } from "../lib/supabase.js";

export interface AuthedRequest extends Request {
  user?: { id: string; email: string | null };
  jwt?: string;
}

/**
 * Validates the Supabase JWT from the Authorization header. On success
 * attaches `req.user` and `req.jwt`; on failure responds 401.
 *
 * When DEV_BYPASS_AUTH is enabled, this middleware short-circuits and
 * attaches a stable fake user. No Supabase call is made.
 */
export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (env.devBypassAuth) {
    req.user = { id: env.devUserId, email: env.devUserEmail };
    req.jwt = undefined;
    next();
    return;
  }

  const header = req.header("authorization") ?? req.header("Authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const jwt = header.slice("bearer ".length).trim();
  if (!jwt) {
    res.status(401).json({ error: "Empty bearer token" });
    return;
  }

  const { data, error } = await supabaseAdmin().auth.getUser(jwt);
  if (error || !data.user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  req.user = { id: data.user.id, email: data.user.email ?? null };
  req.jwt = jwt;
  next();
}
