/**
 * Thin client wrappers around the `/api/sessions` endpoints used by the
 * SessionsModal. Reuses `apiJson` so auth headers and JSON parsing
 * (including the structured `ApiError` thrown on non-2xx) are
 * consistent with the rest of the app.
 */

import type { SessionRecord } from "@seneca/shared";
import { apiJson } from "./api";

/** Light summary the list endpoint returns — full row is paged in on switch. */
export interface SessionSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
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

export async function deleteSession(id: string): Promise<void> {
  await apiJson<void>(`/api/sessions/${id}`, { method: "DELETE" });
}

export async function fetchSessionRow(id: string): Promise<SessionRecord> {
  return apiJson<SessionRecord>(`/api/sessions/${id}`);
}
