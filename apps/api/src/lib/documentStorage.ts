/**
 * Bytes-storage abstraction for uploaded PDFs. Mirrors the sessionStore
 * pattern: one interface, two implementations chosen at boot.
 *
 *   - memoryDocumentStore: process-local Map<docId, { bytes, contentType }>.
 *     Resets on server restart. Used in DEV_BYPASS_AUTH mode so the whole
 *     stack runs with just an Anthropic key and no Supabase project.
 *   - supabaseDocumentStore: real Storage-backed store. Bytes live in a
 *     private bucket `seneca-documents` under `{userId}/{sessionId}/{docId}.pdf`.
 *
 * The route handler is responsible for verifying session ownership before
 * calling write/delete here. We deliberately don't re-check ownership in
 * this layer — by the time you have a userId + sessionId + docId, you've
 * already passed through requireAuth + sessionStore.getById.
 */

import { env } from "../env.js";
import { supabaseAdmin } from "./supabase.js";

/** Magic number for PDF files. We sniff this on upload as a defensive check. */
const PDF_MAGIC = Buffer.from("%PDF-");

const BUCKET = "seneca-documents";

export interface DocumentBytes {
  bytes: Buffer;
  contentType: string;
}

export interface DocumentStore {
  put(
    userId: string,
    sessionId: string,
    documentId: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void>;
  get(
    userId: string,
    sessionId: string,
    documentId: string,
  ): Promise<DocumentBytes | null>;
  delete(
    userId: string,
    sessionId: string,
    documentId: string,
  ): Promise<void>;
  /**
   * Best-effort wipe of every blob under `{userId}/{sessionId}/`. Used by
   * the session delete cascade so an unclean upload (bytes uploaded but
   * never registered in `sessions.documents.items`) can't leave orphans
   * lingering in the bucket.
   */
  deleteForSession(userId: string, sessionId: string): Promise<void>;
}

/**
 * True when the buffer starts with the PDF magic bytes (%PDF-). Cheap
 * defence-in-depth on top of mime checks the route layer already does.
 */
export function looksLikePdf(bytes: Buffer): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

// ── memory implementation ───────────────────────────────────────────────────

const memoryBytes = new Map<string, DocumentBytes>();

function memoryKey(
  userId: string,
  sessionId: string,
  documentId: string,
): string {
  return `${userId}/${sessionId}/${documentId}`;
}

const memoryDocumentStore: DocumentStore = {
  async put(userId, sessionId, documentId, bytes, contentType) {
    memoryBytes.set(memoryKey(userId, sessionId, documentId), {
      bytes,
      contentType,
    });
  },
  async get(userId, sessionId, documentId) {
    return memoryBytes.get(memoryKey(userId, sessionId, documentId)) ?? null;
  },
  async delete(userId, sessionId, documentId) {
    memoryBytes.delete(memoryKey(userId, sessionId, documentId));
  },
  async deleteForSession(userId, sessionId) {
    const prefix = `${userId}/${sessionId}/`;
    for (const key of Array.from(memoryBytes.keys())) {
      if (key.startsWith(prefix)) memoryBytes.delete(key);
    }
  },
};

// ── supabase implementation ─────────────────────────────────────────────────

function storagePath(
  userId: string,
  sessionId: string,
  documentId: string,
): string {
  return `${userId}/${sessionId}/${documentId}.pdf`;
}

const supabaseDocumentStore: DocumentStore = {
  async put(userId, sessionId, documentId, bytes, contentType) {
    const path = storagePath(userId, sessionId, documentId);
    const { error } = await supabaseAdmin()
      .storage.from(BUCKET)
      .upload(path, bytes, {
        contentType,
        upsert: true,
      });
    if (error) throw new Error(error.message);
  },
  async get(userId, sessionId, documentId) {
    const path = storagePath(userId, sessionId, documentId);
    const { data, error } = await supabaseAdmin()
      .storage.from(BUCKET)
      .download(path);
    if (error) {
      // The Supabase SDK returns 400 on not-found; treat that as null so
      // the route handler can return a clean 404.
      const status = (error as { status?: number }).status;
      if (status === 404 || /not.?found/i.test(error.message)) return null;
      throw new Error(error.message);
    }
    if (!data) return null;
    const arr = await data.arrayBuffer();
    return {
      bytes: Buffer.from(arr),
      contentType: data.type || "application/pdf",
    };
  },
  async delete(userId, sessionId, documentId) {
    const path = storagePath(userId, sessionId, documentId);
    const { error } = await supabaseAdmin()
      .storage.from(BUCKET)
      .remove([path]);
    if (error) throw new Error(error.message);
  },
  async deleteForSession(userId, sessionId) {
    const prefix = `${userId}/${sessionId}`;
    // Supabase Storage's `list` is paginated; we keep paging until empty
    // because a session can legitimately accumulate many uploads.
    const PAGE_SIZE = 100;
    let offset = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin()
        .storage.from(BUCKET)
        .list(prefix, { limit: PAGE_SIZE, offset });
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      const paths = data.map((entry) => `${prefix}/${entry.name}`);
      const { error: removeErr } = await supabaseAdmin()
        .storage.from(BUCKET)
        .remove(paths);
      if (removeErr) throw new Error(removeErr.message);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  },
};

export const documentStore: DocumentStore = env.devBypassAuth
  ? memoryDocumentStore
  : supabaseDocumentStore;
