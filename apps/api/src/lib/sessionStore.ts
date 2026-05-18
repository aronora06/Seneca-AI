/**
 * Session storage abstraction. Routes call this; the implementation is
 * picked based on env.devBypassAuth.
 *
 *   - memoryStore: process-local Map. Resets on server restart. Used when
 *     the app is running in dev-bypass mode so a developer can run the
 *     full stack with just an Anthropic key.
 *   - supabaseStore: real Postgres-backed store, RLS-enforced via the
 *     user's JWT. Used in normal auth mode.
 *
 * Both implementations share the SessionStore interface so route handlers
 * don't have to branch on which one is active.
 */

import type {
  DocumentsState,
  MapState,
  SessionRecord,
  SessionUsage,
  TranscriptMessage,
  WebState,
  WhiteboardState,
} from "@seneca/shared";
import {
  DEFAULT_DOCUMENTS_STATE,
  DEFAULT_MAP_STATE,
  DEFAULT_SESSION_USAGE,
  DEFAULT_WEB_STATE,
} from "@seneca/shared";

import { env } from "../env.js";
import { supabaseForUser } from "./supabase.js";

/**
 * Compact summary used by the SessionsModal — keeps the list query cheap
 * by avoiding the multi-MB transcript / whiteboard / documents JSONB
 * columns we don't need to render a card. Phase D adds a handful of
 * derived previews (`lastMessageAt`, `lastUserText`, `documentCount`,
 * `tabs`) so the cards in the modal can show *what's in* each session
 * without a second round-trip per row.
 */
export interface SessionSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  /** Phase D — pinned sessions sort to the top. */
  pinned?: boolean;
  /** ISO timestamp of the last transcript entry, or null when empty. */
  lastMessageAt?: string | null;
  /**
   * First ~140 chars of the most recent *user* message, used as the
   * snippet on the card. We deliberately prefer the user side: it
   * tells the human what they were *asking about*, which is the way
   * they remember a session.
   */
  lastUserText?: string | null;
  /** Count of documents currently attached to the session. */
  documentCount?: number;
  /**
   * Which canvas tabs were touched in this session. Today derived
   * from documents (any items → `documents`), the persisted web URL
   * (`web`), persisted map state (`map`), and whiteboard scene
   * (`whiteboard`). The modal renders small icons for these so the
   * user can spot at a glance which session was the one with the map.
   */
  tabs?: SessionTabFlag[];
}

/** Canvas-tab markers shown as icons on a session card. */
export type SessionTabFlag = "documents" | "web" | "map" | "whiteboard";

export interface SessionStore {
  /** Get the user's current session, creating one if it doesn't exist. */
  getOrCreateCurrent(userId: string, jwt?: string): Promise<SessionRecord>;
  /**
   * Lightweight list for the sessions modal. Sorted by updated_at desc so
   * the most recently used session is the natural default to open.
   */
  list(userId: string, jwt?: string): Promise<SessionSummary[]>;
  /** Create a fresh empty session and return the full row. */
  create(
    userId: string,
    name: string,
    jwt?: string,
  ): Promise<SessionRecord>;
  /** Rename. Throws on rows not owned by the caller. */
  rename(
    sessionId: string,
    userId: string,
    name: string,
    jwt?: string,
  ): Promise<void>;
  /**
   * Hard-delete a session row. Cascading cleanup of document bytes /
   * extracted text / Supabase Storage prefixes is the route handler's
   * responsibility — this method only removes the session row itself.
   */
  delete(
    sessionId: string,
    userId: string,
    jwt?: string,
  ): Promise<void>;
  /**
   * Confirm a session belongs to the user; returns the id + web + documents
   * state or null. The web state is needed so the chat agent loop can resolve
   * `web_read_page` against the current URL without a second round-trip;
   * the documents state lets the loop clamp `document_go_to_page` calls
   * against the real page count without another query.
   */
  getById(
    sessionId: string,
    userId: string,
    jwt?: string,
  ): Promise<Pick<SessionRecord, "id" | "web" | "documents"> | null>;
  /** Full row for switching sessions on the client. Null if not owned / missing. */
  getFullById(
    sessionId: string,
    userId: string,
    jwt?: string,
  ): Promise<SessionRecord | null>;
  updateWhiteboard(
    sessionId: string,
    userId: string,
    whiteboard: WhiteboardState,
    jwt?: string,
  ): Promise<void>;
  updateTranscript(
    sessionId: string,
    userId: string,
    transcript: TranscriptMessage[],
    jwt?: string,
  ): Promise<void>;
  updateMap(
    sessionId: string,
    userId: string,
    map: MapState,
    jwt?: string,
  ): Promise<void>;
  updateWeb(
    sessionId: string,
    userId: string,
    web: WebState,
    jwt?: string,
  ): Promise<void>;
  updateDocuments(
    sessionId: string,
    userId: string,
    documents: DocumentsState,
    jwt?: string,
  ): Promise<void>;
  /**
   * Phase 4: additive accumulator for per-turn cost telemetry.
   * Implementations read the current usage blob, sum in the delta, and
   * write it back. Best-effort — telemetry never blocks the user.
   */
  bumpUsage(
    sessionId: string,
    userId: string,
    jwt: string | undefined,
    delta: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      inputCostUSD: number;
      outputCostUSD: number;
      /** Phase C — characters synthesised through ElevenLabs. */
      ttsCharacters?: number;
      /** Phase C — running ElevenLabs cost in USD. */
      ttsCostUSD?: number;
    },
  ): Promise<void>;
  /**
   * Phase D — star / unstar a session. Pinned sessions sort to the top
   * of the sessions list / modal. Best-effort against the `pinned`
   * column; tolerates older deployments that haven't run the
   * migration (silently no-ops, mirroring the `usage` pattern).
   */
  setPinned(
    sessionId: string,
    userId: string,
    pinned: boolean,
    jwt?: string,
  ): Promise<void>;
}

// ── summary helper ──────────────────────────────────────────────────────────

/**
 * Derive the cheap-to-render fields the SessionsModal needs (last user
 * message snippet, document count, which tabs were used) from a full
 * session row. Centralised here so the memory store and the supabase
 * store render the same shape.
 */
export function summarizeSession(row: SessionRecord): SessionSummary {
  const transcript = Array.isArray(row.transcript) ? row.transcript : [];
  const lastMessage =
    transcript.length > 0 ? transcript[transcript.length - 1] : null;
  // Walk backwards for the most recent user-authored line — that's what
  // a returning user actually remembers ("I was asking about X").
  let lastUser: TranscriptMessage | null = null;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m && m.role === "user" && typeof m.text === "string" && m.text.trim()) {
      lastUser = m;
      break;
    }
  }
  const docs = Array.isArray(row.documents?.items) ? row.documents!.items : [];
  const tabs: SessionTabFlag[] = [];
  if (docs.length > 0) tabs.push("documents");
  if (row.web?.url) tabs.push("web");
  if (
    (Array.isArray(row.map?.pins) && row.map!.pins.length > 0) ||
    (Array.isArray(row.map?.shapes) && row.map!.shapes.length > 0)
  ) {
    tabs.push("map");
  }
  if (
    Array.isArray(row.whiteboard?.elements) &&
    row.whiteboard!.elements.length > 0
  ) {
    tabs.push("whiteboard");
  }
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pinned: row.pinned === true,
    lastMessageAt: lastMessage?.ts ?? null,
    lastUserText: lastUser ? truncateSnippet(lastUser.text) : null,
    documentCount: docs.length,
    tabs,
  };
}

/** Truncate to ~140 chars on a word boundary so cards don't wrap forever. */
function truncateSnippet(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 140) return collapsed;
  const cut = collapsed.slice(0, 140);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut) + "…";
}

// ── in-memory implementation ────────────────────────────────────────────────

interface MemorySession extends SessionRecord {}

const memorySessions = new Map<string, MemorySession>();

function nowIso(): string {
  return new Date().toISOString();
}

const memoryStore: SessionStore = {
  async getOrCreateCurrent(userId) {
    // The current session is the most recently updated one for this user.
    // Mirrors the supabase store's "ORDER BY updated_at DESC LIMIT 1".
    let mostRecent: MemorySession | null = null;
    for (const row of memorySessions.values()) {
      if (row.user_id !== userId) continue;
      if (!mostRecent || row.updated_at > mostRecent.updated_at) {
        mostRecent = row;
      }
    }
    if (mostRecent) return mostRecent;

    const row: MemorySession = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: "Dev session",
      transcript: [],
      whiteboard: { elements: [] },
      map: { ...DEFAULT_MAP_STATE },
      web: { ...DEFAULT_WEB_STATE },
      documents: { ...DEFAULT_DOCUMENTS_STATE },
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    memorySessions.set(row.id, row);
    return row;
  },

  async list(userId) {
    const out: SessionSummary[] = [];
    for (const row of memorySessions.values()) {
      if (row.user_id !== userId) continue;
      out.push(summarizeSession(row));
    }
    // Pinned first, then most-recently-active. The modal applies the
    // same sort on the client so any future server changes stay
    // consistent without a client redeploy.
    out.sort((a, b) => {
      if ((a.pinned === true) !== (b.pinned === true)) {
        return a.pinned === true ? -1 : 1;
      }
      return a.updated_at < b.updated_at ? 1 : -1;
    });
    return out;
  },

  async create(userId, name) {
    const row: MemorySession = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: name.trim() || "Untitled",
      transcript: [],
      whiteboard: { elements: [] },
      map: { ...DEFAULT_MAP_STATE },
      web: { ...DEFAULT_WEB_STATE },
      documents: { ...DEFAULT_DOCUMENTS_STATE },
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    memorySessions.set(row.id, row);
    return row;
  },

  async rename(sessionId, userId, name) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) {
      throw new Error("Session not found.");
    }
    row.name = name.trim() || row.name;
    row.updated_at = nowIso();
  },

  async delete(sessionId, userId) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return;
    memorySessions.delete(sessionId);
  },

  async getById(sessionId, userId) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return null;
    return { id: row.id, web: row.web, documents: row.documents };
  },

  async getFullById(sessionId, userId) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return null;
    return row;
  },

  async updateWhiteboard(sessionId, userId, whiteboard) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return;
    row.whiteboard = whiteboard;
    row.updated_at = nowIso();
  },

  async updateTranscript(sessionId, userId, transcript) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return;
    row.transcript = transcript;
    row.updated_at = nowIso();
  },

  async updateMap(sessionId, userId, map) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return;
    row.map = map;
    row.updated_at = nowIso();
  },

  async updateWeb(sessionId, userId, web) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return;
    row.web = web;
    row.updated_at = nowIso();
  },

  async updateDocuments(sessionId, userId, documents) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return;
    row.documents = documents;
    row.updated_at = nowIso();
  },

  async setPinned(sessionId, userId, pinned) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return;
    row.pinned = pinned;
    // Toggling pinned doesn't bump updated_at — pinning isn't "activity",
    // and we don't want a star click to reshuffle the time-ordered list.
  },

  async bumpUsage(sessionId, userId, _jwt, delta) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return;
    const current: SessionUsage = row.usage ?? { ...DEFAULT_SESSION_USAGE };
    row.usage = {
      inputTokens: current.inputTokens + delta.inputTokens,
      outputTokens: current.outputTokens + delta.outputTokens,
      cacheReadInputTokens:
        current.cacheReadInputTokens + delta.cacheReadInputTokens,
      cacheCreationInputTokens:
        current.cacheCreationInputTokens + delta.cacheCreationInputTokens,
      inputCostUSD: current.inputCostUSD + delta.inputCostUSD,
      outputCostUSD: current.outputCostUSD + delta.outputCostUSD,
      ttsCharacters: (current.ttsCharacters ?? 0) + (delta.ttsCharacters ?? 0),
      ttsCostUSD: (current.ttsCostUSD ?? 0) + (delta.ttsCostUSD ?? 0),
      updatedAt: nowIso(),
    };
    row.updated_at = nowIso();
  },
};

// ── supabase implementation ─────────────────────────────────────────────────

function requireJwt(jwt: string | undefined): string {
  if (!jwt) throw new Error("Supabase store requires a user JWT");
  return jwt;
}

const supabaseStore: SessionStore = {
  async getOrCreateCurrent(_userId, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { data: existing, error: selectErr } = await client
      .from("sessions")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selectErr) throw new Error(selectErr.message);
    if (existing) return withDefaults(existing as SessionRecord);

    const { data: created, error: insertErr } = await client
      .from("sessions")
      .insert({
        name: "First session",
        map: DEFAULT_MAP_STATE,
        web: DEFAULT_WEB_STATE,
        documents: DEFAULT_DOCUMENTS_STATE,
      })
      .select()
      .single();
    if (insertErr || !created) {
      throw new Error(insertErr?.message ?? "Failed to create session");
    }
    return withDefaults(created as SessionRecord);
  },

  async list(_userId, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    // We pull the JSONB columns the summary needs (transcript,
    // documents, web, map, whiteboard) so the cards in the modal can
    // show a real preview. Slightly bigger payload than the bare
    // metadata SELECT we used through Phase C, but the alternative
    // would be denormalising last_user_text / document_count into
    // their own columns and updating them on every write — too much
    // churn for the Phase D appetite. Postgres will short-circuit
    // empty JSONB columns in well under a millisecond per row, and
    // typical users have <100 sessions.
    const { data, error } = await client
      .from("sessions")
      .select(
        "id, name, created_at, updated_at, pinned, transcript, documents, web, map, whiteboard",
      )
      .order("updated_at", { ascending: false });
    if (error) {
      // Older deployments without the `pinned` column return "column
      // does not exist". Fall back to the legacy projection so the
      // modal keeps working pre-migration.
      if (/column .* does not exist/i.test(error.message)) {
        const fallback = await client
          .from("sessions")
          .select(
            "id, name, created_at, updated_at, transcript, documents, web, map, whiteboard",
          )
          .order("updated_at", { ascending: false });
        if (fallback.error) throw new Error(fallback.error.message);
        return (fallback.data ?? []).map((r) =>
          summarizeSession(withDefaults(r as SessionRecord)),
        );
      }
      throw new Error(error.message);
    }
    return (data ?? []).map((r) =>
      summarizeSession(withDefaults(r as SessionRecord)),
    );
  },

  async create(_userId, name, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { data: created, error: insertErr } = await client
      .from("sessions")
      .insert({
        name: name.trim() || "Untitled",
        map: DEFAULT_MAP_STATE,
        web: DEFAULT_WEB_STATE,
        documents: DEFAULT_DOCUMENTS_STATE,
      })
      .select()
      .single();
    if (insertErr || !created) {
      throw new Error(insertErr?.message ?? "Failed to create session");
    }
    return withDefaults(created as SessionRecord);
  },

  async rename(sessionId, _userId, name, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Session name cannot be empty.");
    const { error } = await client
      .from("sessions")
      .update({ name: trimmed })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  },

  async delete(sessionId, _userId, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { error } = await client
      .from("sessions")
      .delete()
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  },

  async getById(sessionId, _userId, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { data, error } = await client
      .from("sessions")
      .select("id, web, documents")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as { id: string; web?: unknown; documents?: unknown };
    return {
      id: row.id,
      web: isValidWeb(row.web) ? row.web : { ...DEFAULT_WEB_STATE },
      documents: isValidDocuments(row.documents)
        ? row.documents
        : { ...DEFAULT_DOCUMENTS_STATE },
    };
  },

  async getFullById(sessionId, _userId, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { data, error } = await client
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return withDefaults(data as SessionRecord);
  },

  async updateWhiteboard(sessionId, _userId, whiteboard, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { error } = await client
      .from("sessions")
      .update({ whiteboard })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  },

  async updateTranscript(sessionId, _userId, transcript, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { error } = await client
      .from("sessions")
      .update({ transcript })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  },

  async updateMap(sessionId, _userId, map, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { error } = await client
      .from("sessions")
      .update({ map })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  },

  async updateWeb(sessionId, _userId, web, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { error } = await client
      .from("sessions")
      .update({ web })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  },

  async updateDocuments(sessionId, _userId, documents, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { error } = await client
      .from("sessions")
      .update({ documents })
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
  },

  async setPinned(sessionId, _userId, pinned, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { error } = await client
      .from("sessions")
      .update({ pinned })
      .eq("id", sessionId);
    if (error) {
      // Pre-migration deployments don't have the column yet — treat
      // the pin as a no-op and let the UI flip its local optimistic
      // state. The next list() call will surface the un-pinned state
      // and we'll be honest about it.
      if (!/column .* does not exist/i.test(error.message)) {
        throw new Error(error.message);
      }
    }
  },

  async bumpUsage(sessionId, _userId, jwt, delta) {
    // Read-modify-write is technically racy if two turns finish at the
    // exact same millisecond on the same session, but the cost pill
    // tolerates a stale read by one turn and the chance of true
    // concurrent finishes per session is negligible. A `pg_advisory_xact_lock`
    // would be overkill for a non-financial UX hint.
    const client = supabaseForUser(requireJwt(jwt));
    const { data, error: readErr } = await client
      .from("sessions")
      .select("usage")
      .eq("id", sessionId)
      .maybeSingle();
    if (readErr) {
      // Older deployments without the `usage` column return "column does
      // not exist"; treat as missing and let the write below fail
      // gracefully (the route handler logs + swallows).
      if (!/column .* does not exist/i.test(readErr.message)) {
        throw new Error(readErr.message);
      }
    }
    const row = data as { usage?: SessionUsage } | null;
    const current: SessionUsage = row?.usage ?? { ...DEFAULT_SESSION_USAGE };
    const next: SessionUsage = {
      inputTokens: current.inputTokens + delta.inputTokens,
      outputTokens: current.outputTokens + delta.outputTokens,
      cacheReadInputTokens:
        current.cacheReadInputTokens + delta.cacheReadInputTokens,
      cacheCreationInputTokens:
        current.cacheCreationInputTokens + delta.cacheCreationInputTokens,
      inputCostUSD: current.inputCostUSD + delta.inputCostUSD,
      outputCostUSD: current.outputCostUSD + delta.outputCostUSD,
      ttsCharacters: (current.ttsCharacters ?? 0) + (delta.ttsCharacters ?? 0),
      ttsCostUSD: (current.ttsCostUSD ?? 0) + (delta.ttsCostUSD ?? 0),
      updatedAt: nowIso(),
    };
    const { error: writeErr } = await client
      .from("sessions")
      .update({ usage: next })
      .eq("id", sessionId);
    if (writeErr) {
      if (!/column .* does not exist/i.test(writeErr.message)) {
        throw new Error(writeErr.message);
      }
    }
  },
};

/**
 * Backfill jsonb columns added in later phases. Lets the app keep working
 * for users who haven't run the migration yet.
 */
function withDefaults(row: SessionRecord): SessionRecord {
  let next = row;
  if (!isValidMap(next.map)) {
    next = { ...next, map: { ...DEFAULT_MAP_STATE } };
  }
  if (!isValidWeb(next.web)) {
    next = { ...next, web: { ...DEFAULT_WEB_STATE } };
  }
  if (!isValidDocuments(next.documents)) {
    next = { ...next, documents: { ...DEFAULT_DOCUMENTS_STATE } };
  }
  if (typeof next.pinned !== "boolean") {
    next = { ...next, pinned: false };
  }
  return next;
}

function isValidMap(v: unknown): v is MapState {
  return (
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as { pins?: unknown }).pins)
  );
}

function isValidWeb(v: unknown): v is WebState {
  return (
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as { history?: unknown }).history)
  );
}

function isValidDocuments(v: unknown): v is DocumentsState {
  return (
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as { items?: unknown }).items)
  );
}

export const sessionStore: SessionStore = env.devBypassAuth
  ? memoryStore
  : supabaseStore;
