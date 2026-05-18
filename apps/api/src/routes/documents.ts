/**
 * Routes powering the Documents tab:
 *   - POST   /api/sessions/:id/documents               upload a document
 *   - GET    /api/sessions/:id/documents/:docId/bytes  stream the bytes back for rendering
 *   - GET    /api/sessions/:id/documents/:docId/pages  extracted text pages (non-PDF viewers)
 *   - DELETE /api/sessions/:id/documents/:docId        remove the doc + bytes
 *
 * All behind requireAuth and a session-ownership check before touching
 * blob storage.
 *
 * Phase 5 widened the upload route from PDF-only to a registry of
 * format-specific extractors (PDF, .docx, .pptx, .md/.txt, .html). The
 * client passes `Content-Type` + an `X-File-Name` header; the registry
 * uses both plus a magic-byte sniff to pick the right extractor.
 * Limit is 25 MB per the vision doc; we accept up to 26 MB server-side
 * and reject anything bigger with a 413.
 */

import { Router, type Response, type RequestHandler } from "express";
import express from "express";

import type { DocumentRecord, DocumentsState } from "@seneca/shared";
import { DEFAULT_DOCUMENTS_STATE } from "@seneca/shared";

import { documentChunkStore } from "../lib/documentChunkStore.js";
import { documentStore } from "../lib/documentStorage.js";
import {
  allSupportedMimes,
  selectExtractor,
} from "../lib/documentExtractors/index.js";
import { documentTextStore } from "../lib/documentTextStore.js";
import { chunkPages } from "../lib/pdfChunker.js";
import { sessionStore } from "../lib/sessionStore.js";
import {
  embed,
  VoyageNotConfiguredError,
} from "../lib/voyageEmbeddings.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { env } from "../env.js";

export const documentsRouter = Router();

const MAX_BYTES = 25 * 1024 * 1024;
const RAW_BUFFER_LIMIT = "26mb";

// Phase 5: accept any mime registered with the extractor registry,
// plus a generic octet-stream fallback for clients that don't bother
// to set Content-Type. The registry sniffs the body to pick the right
// extractor regardless of how the client labelled it.
const ACCEPTED_MIME_PATTERNS = [
  ...allSupportedMimes(),
  "application/octet-stream",
];

// express.raw's `type` option accepts a callback that gets the
// request — we use that to claim every mime our registry knows about
// plus the catch-all `application/octet-stream`. A single middleware
// across every supported format keeps the wire shape stable.
const acceptedSet = new Set(ACCEPTED_MIME_PATTERNS.map((m) => m.toLowerCase()));
const rawUploadParser: RequestHandler = express.raw({
  type: (req) => {
    const t = (req.headers["content-type"] ?? "")
      .toLowerCase()
      .split(";")[0]
      ?.trim();
    return t ? acceptedSet.has(t) : false;
  },
  limit: RAW_BUFFER_LIMIT,
});

documentsRouter.post(
  "/api/sessions/:id/documents",
  requireAuth,
  rawUploadParser,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const sessionId = req.params.id;

    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      res
        .status(400)
        .json({ error: "Body must be a non-empty document upload." });
      return;
    }
    if (bytes.length > MAX_BYTES) {
      res.status(413).json({
        error: `Upload is too large. Max upload size is ${
          MAX_BYTES / 1024 / 1024
        } MB.`,
      });
      return;
    }

    const filenameHeader = req.header("x-file-name");
    const filename = sanitiseFilename(filenameHeader) ?? "document";

    // Phase 5: pick an extractor from the registry by mime + extension
    // + magic-byte sniff. Returns null for unsupported uploads (e.g.
    // a random image, a zipped binary that isn't OOXML).
    const mimeHeader = req.header("content-type");
    const extractor = selectExtractor({
      mime: mimeHeader,
      filename,
      bytes,
    });
    if (!extractor) {
      res.status(415).json({
        error:
          "Unsupported file type. Seneca accepts PDF, .docx, .pptx, .html, .md and .txt.",
      });
      return;
    }
    const displayName = stripExtensionFromName(filename);

    let row;
    try {
      row = await sessionStore.getById(sessionId, req.user.id, req.jwt);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!row) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    const documentId = crypto.randomUUID();
    // Capture the byte length BEFORE any pdfjs call runs. pdfjs detaches
    // the underlying ArrayBuffer of the data it parses; without copying
    // before passing it in we'd get bytes.length === 0 after extraction
    // and the persisted size column would be wrong. The extractor / renderer
    // both copy defensively now, but reading the size up front is a free
    // belt-and-braces guard against any future regression in that path.
    const uploadedSize = bytes.length;

    // Use the extractor's first mime as the canonical Content-Type
    // for the stored bytes. The registry guarantees `mimes[0]` is the
    // most-specific type for the format (e.g. PDF → application/pdf,
    // docx → wordprocessingml, not application/zip).
    const storedContentType = extractor.mimes[0] ?? "application/octet-stream";

    try {
      await documentStore.put(
        req.user.id,
        sessionId,
        documentId,
        bytes,
        storedContentType,
      );
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Synchronous text extraction via the format-specific extractor.
    // The user pays a few seconds of upload latency once, in exchange
    // for cheap text reads forever after — and it lets Seneca answer
    // "what does this document say?" without any extra round-trip.
    const extractionStart = Date.now();
    let pageCountFromExtraction = 0;
    let textStatus: DocumentRecord["textStatus"] = "pending";
    let extractedAt: string | null = null;
    let extractedPages: Awaited<
      ReturnType<typeof extractor.extract>
    >["pages"] = [];
    let looksScanned = false;
    try {
      const result = await extractor.extract(bytes);
      extractedPages = result.pages;
      looksScanned = result.looksScanned === true;
      pageCountFromExtraction = result.pages.length;
      textStatus = looksScanned ? "scanned" : "extracted";
      await documentTextStore.put(
        req.user.id,
        sessionId,
        documentId,
        result.pages,
      );
      extractedAt = new Date().toISOString();
      const totalChars = result.pages.reduce(
        (sum, p) => sum + (p.charCount ?? p.text.length),
        0,
      );
      console.log(
        `[seneca] extracted ${result.pages.length} pages (${totalChars} chars, ${textStatus}, ${extractor.id}) in ${Date.now() - extractionStart}ms`,
      );
    } catch (err) {
      textStatus = "failed";
      console.warn(
        `[seneca] ${extractor.id} text extraction failed (will retry on read):`,
        err instanceof Error ? err.message : err,
      );
    }

    // ── chunk + embed (Priority 1b) ───────────────────────────────────────
    // Synchronous indexing: same UX latency story as extraction (the
    // user pays once on upload, then every search is cheap). Failure
    // paths stamp the status field so the sidebar can pill it, and
    // `document_search` always has a substring fallback.
    let indexStatus: DocumentRecord["indexStatus"] = "pending";
    let indexedAt: string | null = null;
    if (textStatus === "extracted" && extractedPages.length > 0) {
      if (!env.voyageApiKey) {
        indexStatus = "skipped";
      } else {
        const indexStart = Date.now();
        try {
          const chunks = chunkPages(extractedPages);
          if (chunks.length === 0) {
            indexStatus = "skipped";
          } else {
            const embeddings = await embed(
              chunks.map((c) => c.text),
              "document",
            );
            const rows = chunks.map((c, i) => ({
              page: c.page,
              chunkIndex: c.chunkIndex,
              text: c.text,
              embedding: embeddings[i]!,
            }));
            await documentChunkStore.put(
              req.user.id,
              sessionId,
              documentId,
              rows,
            );
            indexStatus = "indexed";
            indexedAt = new Date().toISOString();
            console.log(
              `[seneca] indexed ${rows.length} chunks in ${Date.now() - indexStart}ms`,
            );
          }
        } catch (err) {
          indexStatus = "failed";
          if (err instanceof VoyageNotConfiguredError) {
            indexStatus = "skipped";
          } else {
            console.warn(
              "[seneca] PDF chunk indexing failed (search will fall back to substring):",
              err instanceof Error ? err.message : err,
            );
          }
        }
      }
    } else if (looksScanned) {
      indexStatus = "skipped";
    }

    const newRecord: DocumentRecord = {
      id: documentId,
      name: displayName || "document",
      filename,
      // Use the value we captured before extraction ran (see note above).
      size: uploadedSize,
      // Prefer the extracted page count when we have it; the client will
      // confirm it once react-pdf finishes its own parse (and they should
      // always agree). Falling back to 0 preserves the legacy behaviour.
      pageCount: pageCountFromExtraction,
      currentPage: 1,
      uploadedAt: new Date().toISOString(),
      textStatus,
      extractedAt,
      indexStatus,
      indexedAt,
      mime: storedContentType,
      renderHint: extractor.renderHint,
    };

    const previousDocs: DocumentsState = isValidDocs(row.documents)
      ? row.documents
      : { ...DEFAULT_DOCUMENTS_STATE };
    const nextDocs: DocumentsState = {
      items: [...previousDocs.items, newRecord],
      activeId: documentId,
    };

    try {
      await sessionStore.updateDocuments(
        sessionId,
        req.user.id,
        nextDocs,
        req.jwt,
      );
    } catch (err) {
      // Roll the upload back so we don't leak orphan bytes, orphan
      // extracted pages, or orphan chunks. All deletions are best-effort;
      // we'd rather 500 the user than re-throw the cleanup failure.
      await documentStore
        .delete(req.user.id, sessionId, documentId)
        .catch(() => undefined);
      await documentTextStore
        .delete(req.user.id, sessionId, documentId)
        .catch(() => undefined);
      await documentChunkStore
        .delete(req.user.id, sessionId, documentId)
        .catch(() => undefined);
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    res.status(201).json({ document: newRecord, documents: nextDocs });
  },
);

documentsRouter.get(
  "/api/sessions/:id/documents/:docId/bytes",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const { id: sessionId, docId } = req.params;

    let row;
    try {
      row = await sessionStore.getById(sessionId, req.user.id, req.jwt);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!row) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    const docs = isValidDocs(row.documents)
      ? row.documents
      : { ...DEFAULT_DOCUMENTS_STATE };
    const doc = docs.items.find((d) => d.id === docId);
    if (!doc) {
      res.status(404).json({ error: "Document not found." });
      return;
    }

    let bytes;
    try {
      bytes = await documentStore.get(req.user.id, sessionId, docId);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!bytes) {
      res.status(404).json({ error: "Document bytes missing in storage." });
      return;
    }

    res.setHeader("Content-Type", bytes.contentType);
    res.setHeader("Content-Length", String(bytes.bytes.length));
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    );
    res.status(200).end(bytes.bytes);
  },
);

/**
 * GET /api/sessions/:id/documents/:docId/pages
 *
 * Returns the extracted text pages for a document — what the
 * markdown / html viewer renders on the client for non-PDF formats.
 * Responds 404 with `code: "no-text"` when extraction failed or hasn't
 * happened yet, so the client can show a friendly empty state instead
 * of treating it as a generic error.
 */
documentsRouter.get(
  "/api/sessions/:id/documents/:docId/pages",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const { id: sessionId, docId } = req.params;

    let row;
    try {
      row = await sessionStore.getById(sessionId, req.user.id, req.jwt);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!row) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    const docs = isValidDocs(row.documents)
      ? row.documents
      : { ...DEFAULT_DOCUMENTS_STATE };
    const doc = docs.items.find((d) => d.id === docId);
    if (!doc) {
      res.status(404).json({ error: "Document not found." });
      return;
    }

    let pages;
    try {
      pages = await documentTextStore.getAll(req.user.id, sessionId, docId);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!pages || pages.length === 0) {
      res
        .status(404)
        .json({ code: "no-text", error: "No extracted text for this document." });
      return;
    }
    res.json({ pages });
  },
);

documentsRouter.delete(
  "/api/sessions/:id/documents/:docId",
  requireAuth,
  async (req: AuthedRequest, res: Response) => {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    const { id: sessionId, docId } = req.params;

    let row;
    try {
      row = await sessionStore.getById(sessionId, req.user.id, req.jwt);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!row) {
      res.status(404).json({ error: "Session not found." });
      return;
    }

    const docs = isValidDocs(row.documents)
      ? row.documents
      : { ...DEFAULT_DOCUMENTS_STATE };
    const remaining = docs.items.filter((d) => d.id !== docId);

    if (remaining.length === docs.items.length) {
      res.status(404).json({ error: "Document not found." });
      return;
    }

    const nextDocs: DocumentsState = {
      items: remaining,
      activeId:
        docs.activeId === docId
          ? (remaining[remaining.length - 1]?.id ?? null)
          : docs.activeId,
    };

    try {
      await sessionStore.updateDocuments(
        sessionId,
        req.user.id,
        nextDocs,
        req.jwt,
      );
      // Best-effort: if the metadata removed but the bytes / extracted-text
      // deletion fails, we'd rather leak a little data than 500 the user.
      // Cron / cleanup can sweep these later. Run in parallel — they're
      // independent.
      await Promise.allSettled([
        documentStore
          .delete(req.user.id, sessionId, docId)
          .catch((err) =>
            console.warn(
              "[seneca] document bytes delete failed (orphan)",
              err instanceof Error ? err.message : err,
            ),
          ),
        documentTextStore
          .delete(req.user.id, sessionId, docId)
          .catch((err) =>
            console.warn(
              "[seneca] document text delete failed (orphan)",
              err instanceof Error ? err.message : err,
            ),
          ),
        documentChunkStore
          .delete(req.user.id, sessionId, docId)
          .catch((err) =>
            console.warn(
              "[seneca] document chunk delete failed (orphan)",
              err instanceof Error ? err.message : err,
            ),
          ),
      ]);
    } catch (err) {
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    res.json({ documents: nextDocs });
  },
);

function isValidDocs(v: unknown): v is DocumentsState {
  return (
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as { items?: unknown }).items)
  );
}

/**
 * Drop a single trailing extension from a filename for the friendly
 * sidebar display name. Multi-dot filenames like `report.final.docx`
 * become `report.final` (one extension dropped), matching the existing
 * PDF behaviour ("plan.pdf" → "plan").
 */
function stripExtensionFromName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return filename;
  return filename.slice(0, dot);
}

/**
 * Strip path components from an uploaded filename and cap length. Lets us
 * round-trip a friendly Content-Disposition without trusting the header.
 */
function sanitiseFilename(raw: string | undefined): string | null {
  if (!raw) return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  const last = decoded.split(/[\\/]/).pop() ?? decoded;
  const trimmed = last.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!trimmed) return null;
  return trimmed.slice(0, 200);
}
