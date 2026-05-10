/**
 * Minimal session CRUD. Phase 0–2 only needs:
 *   - "give me the current session for this user, creating one if missing"
 *   - "save whiteboard scene"
 *
 * Full session list / rename / delete UI is Phase 4.
 *
 * Backed by `sessionStore`, which is either Supabase or an in-memory store
 * depending on env.devBypassAuth.
 */

import { Router, type Response } from "express";
import type { WhiteboardState } from "@seneca/shared";
import { sessionStore } from "../lib/sessionStore.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const sessionsRouter = Router();

sessionsRouter.get(
  "/api/sessions/current",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    try {
      const row = await sessionStore.getOrCreateCurrent(req.user.id, req.jwt);
      res.json(row);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

sessionsRouter.put(
  "/api/sessions/:id/whiteboard",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    const whiteboard = (req.body ?? {}) as WhiteboardState;
    if (!whiteboard || !Array.isArray(whiteboard.elements)) {
      res
        .status(400)
        .json({ error: "Body must look like { elements, appState, files }." });
      return;
    }
    try {
      await sessionStore.updateWhiteboard(
        id,
        req.user.id,
        whiteboard,
        req.jwt,
      );
      res.status(204).end();
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

sessionsRouter.put(
  "/api/sessions/:id/transcript",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    const body = (req.body ?? {}) as { transcript?: unknown };
    if (!Array.isArray(body.transcript)) {
      res.status(400).json({ error: "Body must be { transcript: [...] }." });
      return;
    }
    try {
      await sessionStore.updateTranscript(
        id,
        req.user.id,
        body.transcript as never,
        req.jwt,
      );
      res.status(204).end();
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);
