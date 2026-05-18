/**
 * Thin client wrappers around the `/api/sessions` endpoints used by the
 * SessionsModal. Reuses `apiJson` so auth headers and JSON parsing
 * (including the structured `ApiError` thrown on non-2xx) are
 * consistent with the rest of the app.
 */

import type { SessionRecord } from "@seneca/shared";
import { apiJson } from "./api";

/** Canvas-tab markers shown as icons on a session card. */
export type SessionTabFlag = "documents" | "web" | "map" | "whiteboard";

/**
 * Summary returned by the list endpoint — full row is paged in on
 * switch. Phase D added the preview fields so the modal can render
 * cards (snippet, doc count, tab icons) without a second round-trip.
 */
export interface SessionSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  /** True when the user has starred the session. */
  pinned?: boolean;
  /** ISO timestamp of the last transcript entry, or null when empty. */
  lastMessageAt?: string | null;
  /** First ~140 chars of the most recent user-authored line. */
  lastUserText?: string | null;
  /** Count of documents currently attached to the session. */
  documentCount?: number;
  /** Which canvas tabs were touched in this session. */
  tabs?: SessionTabFlag[];
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await apiJson<{ sessions: SessionSummary[] }>("/api/sessions");
  return res.sessions ?? [];
}

export async function createSession(name: string): Promise<SessionRecord> {
  return apiJson<SessionRecord>("/api/sessions", {
    method: "POST",
    body: { name },
  });
}

export async function renameSession(id: string, name: string): Promise<void> {
  await apiJson<void>(`/api/sessions/${id}`, {
    method: "PATCH",
    body: { name },
  });
}

/**
 * Phase D — star / unstar a session. Returns void; the modal does an
 * optimistic local flip and re-lists on success to pick up the new
 * pinned-first sort.
 */
export async function setSessionPinned(
  id: string,
  pinned: boolean,
): Promise<void> {
  await apiJson<void>(`/api/sessions/${id}`, {
    method: "PATCH",
    body: { pinned },
  });
}

export async function deleteSession(id: string): Promise<void> {
  await apiJson<void>(`/api/sessions/${id}`, { method: "DELETE" });
}

export async function fetchSessionRow(id: string): Promise<SessionRecord> {
  return apiJson<SessionRecord>(`/api/sessions/${id}`);
}
