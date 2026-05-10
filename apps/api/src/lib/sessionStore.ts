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
  SessionRecord,
  TranscriptMessage,
  WhiteboardState,
} from "@seneca/shared";

import { env } from "../env.js";
import { supabaseForUser } from "./supabase.js";

export interface SessionStore {
  /** Get the user's current session, creating one if it doesn't exist. */
  getOrCreateCurrent(userId: string, jwt?: string): Promise<SessionRecord>;
  /** Confirm a session belongs to the user; returns the row or null. */
  getById(
    sessionId: string,
    userId: string,
    jwt?: string,
  ): Promise<Pick<SessionRecord, "id"> | null>;
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
}

// ── in-memory implementation ────────────────────────────────────────────────

interface MemorySession extends SessionRecord {}

const memorySessions = new Map<string, MemorySession>();

function nowIso(): string {
  return new Date().toISOString();
}

const memoryStore: SessionStore = {
  async getOrCreateCurrent(userId) {
    for (const row of memorySessions.values()) {
      if (row.user_id === userId) return row;
    }
    const row: MemorySession = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: "Dev session",
      transcript: [],
      whiteboard: { elements: [] },
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    memorySessions.set(row.id, row);
    return row;
  },

  async getById(sessionId, userId) {
    const row = memorySessions.get(sessionId);
    if (!row || row.user_id !== userId) return null;
    return { id: row.id };
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
    if (existing) return existing as SessionRecord;

    const { data: created, error: insertErr } = await client
      .from("sessions")
      .insert({ name: "First session" })
      .select()
      .single();
    if (insertErr || !created) {
      throw new Error(insertErr?.message ?? "Failed to create session");
    }
    return created as SessionRecord;
  },

  async getById(sessionId, _userId, jwt) {
    const client = supabaseForUser(requireJwt(jwt));
    const { data, error } = await client
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id as string } : null;
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
};

export const sessionStore: SessionStore = env.devBypassAuth
  ? memoryStore
  : supabaseStore;
