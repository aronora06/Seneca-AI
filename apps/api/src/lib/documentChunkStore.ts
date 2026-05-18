/**
 * Per-document chunk + embedding storage. Mirrors `documentTextStore`:
 * one interface, two implementations chosen at boot.
 *
 *   - memoryDocumentChunkStore: process-local Map<docId, ChunkRow[]>.
 *     `topK` does a brute-force cosine pass — fine for the few-thousand
 *     chunks a session can hold in memory.
 *   - supabaseDocumentChunkStore: a `document_chunks` Postgres table
 *     with an `ivfflat` `vector_cosine_ops` index, and RLS that joins
 *     through `documents → sessions.user_id` so users can only ever
 *     read their own chunks. Schema in docs/setup.md §3.2.
 *
 * The interface intentionally surfaces a `score` from `topK` so the
 * caller doesn't re-derive cosine — pgvector's `<=>` operator returns
 * distance, and the memory impl already has the similarity in hand.
 */

import type { DocumentChunkRow, DocumentChunkHit } from "@seneca/shared";

import { env } from "../env.js";
import { cosineSimilarity } from "./voyageEmbeddings.js";
import { supabaseAdmin } from "./supabase.js";

const TABLE = "document_chunks";

export interface DocumentChunkStore {
  /**
   * Replace any prior chunks for this doc with a fresh embedding pass.
   * Atomic-enough: a single delete-then-insert; no concurrent writers
   * per doc in our model (uploads are serialised through the route).
   */
  put(
    userId: string,
    sessionId: string,
    documentId: string,
    rows: DocumentChunkRow[],
  ): Promise<void>;
  /**
   * Rank chunks by cosine similarity to `queryEmbedding`. When
   * `documentId` is provided, restricts to a single doc; otherwise
   * scores every chunk this user has in this session. Returns at most
   * `topK` rows sorted desc by score.
   */
  topK(
    userId: string,
    sessionId: string,
    queryEmbedding: number[],
    topK: number,
    documentId?: string,
  ): Promise<DocumentChunkHit[]>;
  /** Drop every chunk for a doc. Idempotent — silent on not-found. */
  delete(
    userId: string,
    sessionId: string,
    documentId: string,
  ): Promise<void>;
  /** Drop every chunk for an entire session. Used by session-delete. */
  deleteForSession(userId: string, sessionId: string): Promise<void>;
}

// ── memory implementation ──────────────────────────────────────────────────

interface MemoryChunk extends DocumentChunkRow {
  documentId: string;
}

function memoryKey(
  userId: string,
  sessionId: string,
  documentId: string,
): string {
  return `${userId}/${sessionId}/${documentId}`;
}

function memoryPrefix(userId: string, sessionId: string): string {
  return `${userId}/${sessionId}/`;
}

const memoryChunks = new Map<string, MemoryChunk[]>();

const memoryDocumentChunkStore: DocumentChunkStore = {
  async put(userId, sessionId, documentId, rows) {
    memoryChunks.set(
      memoryKey(userId, sessionId, documentId),
      rows.map((r) => ({ ...r, documentId })),
    );
  },

  async topK(userId, sessionId, queryEmbedding, topK, documentId) {
    const prefix = memoryPrefix(userId, sessionId);
    const candidates: MemoryChunk[] = [];
    for (const [key, rows] of memoryChunks) {
      if (!key.startsWith(prefix)) continue;
      if (documentId) {
        if (key !== memoryKey(userId, sessionId, documentId)) continue;
      }
      for (const r of rows) candidates.push(r);
    }

    const scored: DocumentChunkHit[] = candidates.map((c) => ({
      documentId: c.documentId,
      page: c.page,
      chunkIndex: c.chunkIndex,
      text: c.text,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  },

  async delete(userId, sessionId, documentId) {
    memoryChunks.delete(memoryKey(userId, sessionId, documentId));
  },

  async deleteForSession(userId, sessionId) {
    const prefix = memoryPrefix(userId, sessionId);
    for (const key of memoryChunks.keys()) {
      if (key.startsWith(prefix)) memoryChunks.delete(key);
    }
  },
};

// ── supabase implementation ────────────────────────────────────────────────

interface DocumentChunkDbRow {
  doc_id: string;
  /**
   * Denormalised so the session-delete cascade can wipe orphan rows
   * with `where session_id = $1`. Older deployments without this column
   * silently ignore it via the JS driver.
   */
  session_id: string;
  page: number;
  chunk_index: number;
  text: string;
  embedding: number[] | string;
}

interface ChunkMatchRpcRow {
  doc_id: string;
  page: number;
  chunk_index: number;
  text: string;
  score: number;
}

const supabaseDocumentChunkStore: DocumentChunkStore = {
  async put(_userId, sessionId, documentId, rows) {
    const client = supabaseAdmin();
    const { error: delErr } = await client
      .from(TABLE)
      .delete()
      .eq("doc_id", documentId);
    if (delErr) throw new Error(delErr.message);

    if (rows.length === 0) return;

    // pgvector accepts arrays directly via the JS driver. We send the
    // embedding as a number[] and let postgrest serialise it.
    const dbRows: DocumentChunkDbRow[] = rows.map((r) => ({
      doc_id: documentId,
      session_id: sessionId,
      page: r.page,
      chunk_index: r.chunkIndex,
      text: r.text,
      embedding: r.embedding,
    }));
    const { error: insErr } = await client
      .from(TABLE)
      .insert(dbRows as unknown as never);
    if (insErr) throw new Error(insErr.message);
  },

  async topK(_userId, _sessionId, queryEmbedding, topK, documentId) {
    const client = supabaseAdmin();
    // Use the RPC defined in setup.md §3.2 to push the cosine math into
    // pgvector (no way to express `<=>` via postgrest filters today).
    // Falls back to a column-level select if the RPC is missing so older
    // deploys keep working — degraded path scores nothing and returns
    // empty so the resolver's substring fallback kicks in.
    const { data, error } = await (
      client.rpc as unknown as (
        fn: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>
    )("match_document_chunks", {
      query_embedding: queryEmbedding,
      match_doc_id: documentId ?? null,
      match_count: topK,
    });
    if (error) {
      // Treat "function does not exist" the same as zero hits — the
      // resolver will fall back to substring search.
      if (/function .* does not exist/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    const rows = (data ?? []) as ChunkMatchRpcRow[];
    return rows.map((r) => ({
      documentId: r.doc_id,
      page: r.page,
      chunkIndex: r.chunk_index,
      text: r.text,
      score: r.score,
    }));
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
    // Postgrest doesn't support joins on delete, so we rely on the
    // `ON DELETE CASCADE` foreign key from `documents → sessions` plus
    // `document_chunks → documents`. This method exists for the memory
    // impl; supabase callers can rely on the SQL cascade.
    const client = supabaseAdmin();
    const { error } = await client
      .from(TABLE)
      .delete()
      .eq("session_id", sessionId);
    if (error) {
      // Older schemas without `session_id` denormalised on chunks will
      // see "column does not exist" — the cascade handles it.
      if (!/column .* does not exist/i.test(error.message)) {
        throw new Error(error.message);
      }
    }
  },
};

export const documentChunkStore: DocumentChunkStore = env.devBypassAuth
  ? memoryDocumentChunkStore
  : supabaseDocumentChunkStore;

/**
 * Test surface — both stores share the cosine math, so the memory impl
 * is the natural test target. We expose a factory so tests can build a
 * fresh instance instead of inheriting cross-test state.
 */
export function _createMemoryChunkStore(): DocumentChunkStore {
  const localChunks = new Map<string, MemoryChunk[]>();
  return {
    async put(userId, sessionId, documentId, rows) {
      localChunks.set(
        memoryKey(userId, sessionId, documentId),
        rows.map((r) => ({ ...r, documentId })),
      );
    },
    async topK(userId, sessionId, queryEmbedding, topK, documentId) {
      const prefix = memoryPrefix(userId, sessionId);
      const candidates: MemoryChunk[] = [];
      for (const [key, rows] of localChunks) {
        if (!key.startsWith(prefix)) continue;
        if (documentId) {
          if (key !== memoryKey(userId, sessionId, documentId)) continue;
        }
        for (const r of rows) candidates.push(r);
      }
      const scored: DocumentChunkHit[] = candidates.map((c) => ({
        documentId: c.documentId,
        page: c.page,
        chunkIndex: c.chunkIndex,
        text: c.text,
        score: cosineSimilarity(queryEmbedding, c.embedding),
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK);
    },
    async delete(userId, sessionId, documentId) {
      localChunks.delete(memoryKey(userId, sessionId, documentId));
    },
    async deleteForSession(userId, sessionId) {
      const prefix = memoryPrefix(userId, sessionId);
      for (const key of localChunks.keys()) {
        if (key.startsWith(prefix)) localChunks.delete(key);
      }
    },
  };
}
