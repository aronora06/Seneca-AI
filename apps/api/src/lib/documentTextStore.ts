/**
 * Per-page extracted PDF text storage. Mirrors `documentStorage.ts`:
 * one interface, two implementations chosen at boot.
 *
 *   - memoryDocumentTextStore: process-local Map<docId, DocumentPageText[]>.
 *     Resets on server restart, just like the in-memory bytes store. Used
 *     in DEV_BYPASS_AUTH mode.
 *   - supabaseDocumentTextStore: a `document_pages` Postgres table with
 *     RLS that joins to `sessions.user_id` via the parent doc, so users
 *     can only ever read their own pages. The schema is documented in
 *     docs/setup.md §3.1; see the migration block for upgrading existing
 *     projects.
 *
 * We keep extracted text out of the `sessions.documents` JSONB column on
 * purpose: a 400-page PDF can produce 1–5 MB of text, which would balloon
 * the session row and slow every read of the canvas state.
 */

import type { DocumentPageText } from "@seneca/shared";

import { env } from "../env.js";
import { supabaseAdmin } from "./supabase.js";

const TABLE = "document_pages";

export interface DocumentTextStore {
  /** Replace any prior pages for this doc with a fresh extraction. */
  put(
    userId: string,
    sessionId: string,
    documentId: string,
    pages: DocumentPageText[],
  ): Promise<void>;
  /** Return every page in 1..N order, or null if no extraction was ever stored. */
  getAll(
    userId: string,
    sessionId: string,
    documentId: string,
  ): Promise<DocumentPageText[] | null>;
  /** Return one page. Returns null if the doc has no extraction yet. */
  getPage(
    userId: string,
    sessionId: string,
    documentId: string,
    page: number,
  ): Promise<DocumentPageText | null>;
  /** Drop every page row for a doc. Idempotent — silent on "not found". */
  delete(
    userId: string,
    sessionId: string,
    documentId: string,
  ): Promise<void>;
  /**
   * Drop every page row for an entire session. Used by the session-delete
   * cascade to clean up orphan extractions from uploads that crashed
   * before being added to `sessions.documents.items`.
   *
   * Supabase impl relies on a denormalised `session_id` column on
   * `document_pages` (added via the same migration that introduced the
   * column on `document_chunks`); older schemas without it fall back to
   * a no-op (orphan rows are still hidden by RLS).
   */
  deleteForSession(userId: string, sessionId: string): Promise<void>;
}

// ── memory implementation ──────────────────────────────────────────────────

function memoryKey(
  userId: string,
  sessionId: string,
  documentId: string,
): string {
  return `${userId}/${sessionId}/${documentId}`;
}

const memoryPages = new Map<string, DocumentPageText[]>();

const memoryDocumentTextStore: DocumentTextStore = {
  async put(userId, sessionId, documentId, pages) {
    memoryPages.set(memoryKey(userId, sessionId, documentId), [...pages]);
  },
  async getAll(userId, sessionId, documentId) {
    return memoryPages.get(memoryKey(userId, sessionId, documentId)) ?? null;
  },
  async getPage(userId, sessionId, documentId, page) {
    const all = memoryPages.get(memoryKey(userId, sessionId, documentId));
    if (!all) return null;
    return all.find((p) => p.page === page) ?? null;
  },
  async delete(userId, sessionId, documentId) {
    memoryPages.delete(memoryKey(userId, sessionId, documentId));
  },
  async deleteForSession(userId, sessionId) {
    const prefix = `${userId}/${sessionId}/`;
    for (const key of Array.from(memoryPages.keys())) {
      if (key.startsWith(prefix)) memoryPages.delete(key);
    }
  },
};

// ── supabase implementation ────────────────────────────────────────────────

interface DocumentPageRow {
  doc_id: string;
  /**
   * Denormalised so the session-delete cascade can wipe orphan rows
   * with `where session_id = $1`. Older deployments without this column
   * silently ignore it via the JS driver.
   */
  session_id: string;
  page: number;
  text: string;
  char_count: number;
}

const supabaseDocumentTextStore: DocumentTextStore = {
  async put(_userId, sessionId, documentId, pages) {
    const client = supabaseAdmin();
    // Replace-semantics: drop any prior pages first, then insert the new
    // extraction in one batched call. Using a delete + insert is simpler
    // (and atomic enough for our needs — no concurrent writers per doc)
    // than an upsert-with-primary-key dance.
    const { error: delErr } = await client
      .from(TABLE)
      .delete()
      .eq("doc_id", documentId);
    if (delErr) throw new Error(delErr.message);

    if (pages.length === 0) return;

    const rows: DocumentPageRow[] = pages.map((p) => ({
      doc_id: documentId,
      session_id: sessionId,
      page: p.page,
      text: p.text,
      char_count: p.charCount,
    }));
    // The supabase client doesn't ship typed schemas for our tables, so
    // `insert` types its argument as `never[]`. Cast through unknown to
    // tell tsc we know what we're doing — the runtime SDK happily
    // accepts any plain-object array.
    const { error: insErr } = await client
      .from(TABLE)
      .insert(rows as unknown as never);
    if (insErr) throw new Error(insErr.message);
  },

  async getAll(_userId, _sessionId, documentId) {
    const client = supabaseAdmin();
    const { data, error } = await client
      .from(TABLE)
      .select("doc_id, page, text, char_count")
      .eq("doc_id", documentId)
      .order("page", { ascending: true });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return null;
    return (data as DocumentPageRow[]).map((r) => ({
      page: r.page,
      text: r.text,
      charCount: r.char_count,
    }));
  },

  async getPage(_userId, _sessionId, documentId, page) {
    const client = supabaseAdmin();
    const { data, error } = await client
      .from(TABLE)
      .select("doc_id, page, text, char_count")
      .eq("doc_id", documentId)
      .eq("page", page)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const r = data as DocumentPageRow;
    return { page: r.page, text: r.text, charCount: r.char_count };
  },

  async delete(_userId, _sessionId, documentId) {
    const client = supabaseAdmin();
    const { error } = await client
      .from(TABLE)
      .delete()
      .eq("doc_id", documentId);
    if (error) throw new Error(error.message);
  },

  async deleteForSession(_userId, sessionId) {
    const client = supabaseAdmin();
    const { error } = await client
      .from(TABLE)
      .delete()
      .eq("session_id", sessionId);
    if (error) {
      // Older schemas without `session_id` denormalised on pages will
      // see "column does not exist" — orphans there stay invisible via
      // RLS, which is acceptable until the migration ships.
      if (!/column .* does not exist/i.test(error.message)) {
        throw new Error(error.message);
      }
    }
  },
};

export const documentTextStore: DocumentTextStore = env.devBypassAuth
  ? memoryDocumentTextStore
  : supabaseDocumentTextStore;
