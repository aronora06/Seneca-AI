/**
 * Session CRUD. Backs both the "current session for this user" boot
 * fetch (Phase 0) and the full list / create / rename / delete flow
 * the SessionsModal needs (Phase 3 / Priority 2).
 *
 * Backed by `sessionStore`, which is either Supabase or an in-memory
 * store depending on env.devBypassAuth.
 */

import { Router, type Response } from "express";
import type {
  ActiveTab,
  DiagramsState,
  DocumentsState,
  MapState,
  WebState,
  WhiteboardState,
} from "@seneca/shared";
import { documentChunkStore } from "../lib/documentChunkStore.js";
import { documentStore } from "../lib/documentStorage.js";
import { documentTextStore } from "../lib/documentTextStore.js";
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

sessionsRouter.get(
  "/api/sessions",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    try {
      const rows = await sessionStore.list(req.user.id, req.jwt);
      res.json({ sessions: rows });
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

sessionsRouter.post(
  "/api/sessions",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const body = (req.body ?? {}) as { name?: unknown };
    const rawName = typeof body.name === "string" ? body.name.trim() : "";
    if (rawName.length === 0) {
      res.status(400).json({ error: "Body must be { name: string }." });
      return;
    }
    if (rawName.length > 120) {
      res.status(400).json({ error: "name must be 120 characters or fewer." });
      return;
    }
    try {
      const row = await sessionStore.create(req.user.id, rawName, req.jwt);
      res.status(201).json(row);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

sessionsRouter.get(
  "/api/sessions/:id",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: "Missing session id." });
      return;
    }
    try {
      const row = await sessionStore.getFullById(id, req.user.id, req.jwt);
      if (!row) {
        res.status(404).json({ error: "Session not found." });
        return;
      }
      res.json(row);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

sessionsRouter.patch(
  "/api/sessions/:id",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: "Missing session id." });
      return;
    }
    const body = (req.body ?? {}) as { name?: unknown; pinned?: unknown };

    // Phase D — `name` and `pinned` are independent partial updates so
    // the modal can star a row without re-prompting the user for a name.
    // The body must include at least one of the two known fields.
    const hasName = "name" in body;
    const hasPinned = "pinned" in body;
    if (!hasName && !hasPinned) {
      res.status(400).json({
        error: "Body must include { name } or { pinned } (or both).",
      });
      return;
    }

    try {
      if (hasName) {
        const rawName =
          typeof body.name === "string" ? (body.name as string).trim() : "";
        if (rawName.length === 0) {
          res.status(400).json({ error: "name cannot be blank." });
          return;
        }
        if (rawName.length > 120) {
          res
            .status(400)
            .json({ error: "name must be 120 characters or fewer." });
          return;
        }
        await sessionStore.rename(id, req.user.id, rawName, req.jwt);
      }
      if (hasPinned) {
        if (typeof body.pinned !== "boolean") {
          res.status(400).json({ error: "pinned must be a boolean." });
          return;
        }
        await sessionStore.setPinned(id, req.user.id, body.pinned, req.jwt);
      }
      res.status(204).end();
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

sessionsRouter.delete(
  "/api/sessions/:id",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: "Missing session id." });
      return;
    }
    try {
      // Walk the session's documents and wipe their downstream rows
      // before tearing down the session itself. We do this BEFORE the
      // session row delete so we can still read the docId list.
      // Supabase Storage does not cascade with row delete, so we also
      // wipe the bucket prefix here.
      const full = await sessionStore.getFullById(id, req.user.id, req.jwt);
      const docIds = (full?.documents?.items ?? []).map((d) => d.id);

      await Promise.allSettled(
        docIds.map((docId) =>
          Promise.allSettled([
            documentTextStore
              .delete(req.user!.id, id, docId)
              .catch((err) =>
                console.warn(
                  "[seneca] cascade: text delete failed",
                  err instanceof Error ? err.message : err,
                ),
              ),
            documentChunkStore
              .delete(req.user!.id, id, docId)
              .catch((err) =>
                console.warn(
                  "[seneca] cascade: chunks delete failed",
                  err instanceof Error ? err.message : err,
                ),
              ),
            documentStore
              .delete(req.user!.id, id, docId)
              .catch((err) =>
                console.warn(
                  "[seneca] cascade: bytes delete failed",
                  err instanceof Error ? err.message : err,
                ),
              ),
          ]),
        ),
      );

      // Sweep any orphan rows / blobs the per-docId loop missed
      // (e.g. uploads that crashed mid-pipeline before being added to
      // `sessions.documents.items`).
      await Promise.allSettled([
        documentTextStore
          .deleteForSession(req.user.id, id)
          .catch((err) =>
            console.warn(
              "[seneca] cascade: session-scoped page sweep failed",
              err instanceof Error ? err.message : err,
            ),
          ),
        documentChunkStore
          .deleteForSession(req.user.id, id)
          .catch((err) =>
            console.warn(
              "[seneca] cascade: session-scoped chunk sweep failed",
              err instanceof Error ? err.message : err,
            ),
          ),
        documentStore
          .deleteForSession(req.user.id, id)
          .catch((err) =>
            console.warn(
              "[seneca] cascade: session-scoped bytes sweep failed",
              err instanceof Error ? err.message : err,
            ),
          ),
      ]);

      await sessionStore.delete(id, req.user.id, req.jwt);
      res.status(204).end();
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

const MAX_DIAGRAM_XML_BYTES = 500_000;

function isValidDiagramsState(v: unknown): v is DiagramsState {
  if (!v || typeof v !== "object") return false;
  const xml = (v as { xml?: unknown }).xml;
  if (typeof xml !== "string" || xml.length === 0) return false;
  if (xml.length > MAX_DIAGRAM_XML_BYTES) return false;
  return true;
}

sessionsRouter.put(
  "/api/sessions/:id/diagrams",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    const diagrams = (req.body ?? {}) as DiagramsState;
    if (!isValidDiagramsState(diagrams)) {
      res.status(400).json({
        error: `Body must be { xml: string } with xml ≤ ${MAX_DIAGRAM_XML_BYTES} bytes.`,
      });
      return;
    }
    try {
      await sessionStore.updateDiagrams(id, req.user.id, diagrams, req.jwt);
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

sessionsRouter.put(
  "/api/sessions/:id/map",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    const body = (req.body ?? {}) as Partial<MapState> | null;
    if (!isValidMapState(body)) {
      res.status(400).json({
        error:
          "Body must look like { center:[lat,lng], zoom, layer, pins:[], shapes:[] }.",
      });
      return;
    }
    try {
      await sessionStore.updateMap(id, req.user.id, body, req.jwt);
      res.status(204).end();
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

function isValidMapState(v: unknown): v is MapState {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  if (
    !Array.isArray(m.center) ||
    m.center.length !== 2 ||
    typeof m.center[0] !== "number" ||
    typeof m.center[1] !== "number"
  ) {
    return false;
  }
  if (typeof m.zoom !== "number") return false;
  if (m.layer !== "standard" && m.layer !== "satellite") return false;
  if (!Array.isArray(m.pins)) return false;
  if (!Array.isArray(m.shapes)) return false;
  return true;
}

sessionsRouter.put(
  "/api/sessions/:id/web",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    const body = (req.body ?? {}) as Partial<WebState> | null;
    if (!isValidWebState(body)) {
      res.status(400).json({
        error: "Body must look like { url, history: [], historyIndex }.",
      });
      return;
    }
    try {
      await sessionStore.updateWeb(id, req.user.id, body, req.jwt);
      res.status(204).end();
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

function isValidWebState(v: unknown): v is WebState {
  if (!v || typeof v !== "object") return false;
  const w = v as Record<string, unknown>;
  if (w.url !== null && typeof w.url !== "string") return false;
  if (!Array.isArray(w.history)) return false;
  if (!w.history.every((h) => typeof h === "string")) return false;
  if (typeof w.historyIndex !== "number") return false;
  return true;
}

sessionsRouter.put(
  "/api/sessions/:id/active-tab",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    const tab = (req.body as { activeTab?: unknown })?.activeTab;
    if (
      tab !== "whiteboard" &&
      tab !== "diagrams" &&
      tab !== "documents" &&
      tab !== "web" &&
      tab !== "map"
    ) {
      res.status(400).json({
        error:
          "Body must be { activeTab: 'whiteboard' | 'diagrams' | 'documents' | 'web' | 'map' }.",
      });
      return;
    }
    try {
      await sessionStore.updateActiveTab(
        id,
        req.user.id,
        tab as ActiveTab,
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
  "/api/sessions/:id/documents",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const id = req.params.id;
    const body = (req.body ?? {}) as Partial<DocumentsState> | null;
    if (!isValidDocumentsState(body)) {
      res.status(400).json({
        error:
          "Body must look like { items: DocumentRecord[], activeId: string | null }.",
      });
      return;
    }
    try {
      await sessionStore.updateDocuments(id, req.user.id, body, req.jwt);
      res.status(204).end();
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

function isValidDocumentsState(v: unknown): v is DocumentsState {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  if (!Array.isArray(d.items)) return false;
  if (d.activeId !== null && typeof d.activeId !== "string") return false;
  for (const item of d.items) {
    if (!item || typeof item !== "object") return false;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string") return false;
    if (typeof r.name !== "string") return false;
    if (typeof r.filename !== "string") return false;
    if (typeof r.size !== "number") return false;
    if (typeof r.pageCount !== "number") return false;
    if (typeof r.currentPage !== "number") return false;
    if (typeof r.uploadedAt !== "string") return false;
  }
  return true;
}
