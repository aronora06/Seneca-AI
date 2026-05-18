/**
 * Integration-ish tests for the sessions HTTP routes. We mount the
 * router on a bare Express app and drive it via `supertest`-style
 * fetch using the global `request` helper, keeping everything in-
 * process. The dev-bypass middleware (always on in the test env)
 * stamps the request with the deterministic dev user id so we don't
 * have to mock JWT validation.
 */

import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { documentChunkStore, _createMemoryChunkStore } from "../lib/documentChunkStore.js";
import { documentStore } from "../lib/documentStorage.js";
import { documentTextStore } from "../lib/documentTextStore.js";
import { env } from "../env.js";
import { sessionsRouter } from "./sessions.js";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(sessionsRouter);

let baseUrl = "";
let serverHandle: import("node:http").Server;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      serverHandle = app.listen(0, () => {
        const addr = serverHandle.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      serverHandle.close((err) => (err ? reject(err) : resolve()));
    }),
);

async function api(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

describe("sessions routes (dev-bypass mode)", () => {
  // Memory-backed stores survive across tests; we wipe orphan rows
  // before each test so the cascade assertions don't pick up bleed.
  beforeEach(async () => {
    // We can't easily wipe the memory chunk / text / bytes stores
    // wholesale from outside, but the dev user is stable and each test
    // creates fresh ids that don't collide. Wipe any rows from the
    // standing dev user just in case.
    const list = await api("/api/sessions");
    if (list.status === 200) {
      const { sessions } = list.body as { sessions: Array<{ id: string }> };
      for (const s of sessions) {
        await api(`/api/sessions/${s.id}`, { method: "DELETE" });
      }
    }
  });

  it("GET /api/sessions returns an empty list initially", async () => {
    const res = await api("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessions: [] });
  });

  it("POST /api/sessions creates a row and echoes it", async () => {
    const res = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Tax research" }),
    });
    expect(res.status).toBe(201);
    const row = res.body as { id: string; name: string; user_id: string };
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(row.name).toBe("Tax research");
    expect(row.user_id).toBe(env.devUserId);
  });

  it("POST /api/sessions rejects missing / blank name", async () => {
    const blank = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    expect(blank.status).toBe(400);

    const missing = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
  });

  it("POST /api/sessions rejects overly long names", async () => {
    const long = "x".repeat(121);
    const res = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: long }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/sessions lists rows newest-first", async () => {
    const a = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "First" }),
    });
    // Stagger updated_at since memory store doesn't tick microseconds.
    await new Promise((r) => setTimeout(r, 5));
    const b = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Second" }),
    });
    const list = await api("/api/sessions");
    const { sessions } = list.body as {
      sessions: Array<{ id: string; name: string }>;
    };
    expect(sessions[0]!.id).toBe((b.body as { id: string }).id);
    expect(sessions[1]!.id).toBe((a.body as { id: string }).id);
  });

  it("GET /api/sessions/:id returns the full row", async () => {
    const created = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Detail test" }),
    });
    const id = (created.body as { id: string }).id;
    const res = await api(`/api/sessions/${id}`);
    expect(res.status).toBe(200);
    const row = res.body as { id: string; transcript: unknown[] };
    expect(row.id).toBe(id);
    expect(Array.isArray(row.transcript)).toBe(true);
  });

  it("GET /api/sessions/:id returns 404 for unknown ids", async () => {
    const res = await api("/api/sessions/00000000-0000-4000-8000-deadbeef0000");
    expect(res.status).toBe(404);
  });

  it("PATCH /api/sessions/:id renames", async () => {
    const created = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Old" }),
    });
    const id = (created.body as { id: string }).id;
    const res = await api(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(204);
    const after = await api(`/api/sessions/${id}`);
    expect((after.body as { name: string }).name).toBe("New");
  });

  it("PATCH /api/sessions/:id rejects blank names", async () => {
    const created = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Old" }),
    });
    const id = (created.body as { id: string }).id;
    const res = await api(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /api/sessions/:id removes the row", async () => {
    const created = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Doomed" }),
    });
    const id = (created.body as { id: string }).id;
    const res = await api(`/api/sessions/${id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const after = await api(`/api/sessions/${id}`);
    expect(after.status).toBe(404);
  });

  it("DELETE /api/sessions/:id wipes downstream pages/chunks/bytes", async () => {
    const created = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name: "Cascade" }),
    });
    const sessionId = (created.body as { id: string }).id;

    // Seed the downstream stores with a fake document so the cascade
    // can prove it actually walks them. Document id is whatever — the
    // cascade code reads it from sessions.documents.items, which is
    // empty here, so we ALSO exercise the "session-scoped sweep" branch
    // that wipes prefix-keyed orphans.
    const docId = crypto.randomUUID();
    const userId = env.devUserId;
    await documentTextStore.put(userId, sessionId, docId, [
      { page: 1, text: "hello", charCount: 5 },
    ]);
    await documentChunkStore.put(userId, sessionId, docId, [
      { page: 1, chunkIndex: 0, text: "hello", embedding: [0, 1] },
    ]);
    await documentStore.put(
      userId,
      sessionId,
      docId,
      Buffer.from("not really a pdf"),
      "application/pdf",
    );

    // Sanity: chunks are there pre-delete.
    const beforeChunks = await documentChunkStore.topK(
      userId,
      sessionId,
      [0, 1],
      5,
      docId,
    );
    expect(beforeChunks.length).toBe(1);

    const res = await api(`/api/sessions/${sessionId}`, { method: "DELETE" });
    expect(res.status).toBe(204);

    // All three should be empty.
    expect(
      await documentTextStore.getAll(userId, sessionId, docId),
    ).toBeNull();
    expect(
      await documentChunkStore.topK(userId, sessionId, [0, 1], 5, docId),
    ).toEqual([]);
    expect(await documentStore.get(userId, sessionId, docId)).toBeNull();
  });

  it("DELETE /api/sessions/:id is a no-op for unknown ids (idempotent)", async () => {
    const res = await api("/api/sessions/00000000-0000-4000-8000-aaaaaaaaaaaa", {
      method: "DELETE",
    });
    // Memory store silently no-ops on missing rows so cascade wraps in 204.
    expect(res.status).toBe(204);
  });
});

// Tiny safety check on the test scaffolding itself so a regression in
// `_createMemoryChunkStore` (used elsewhere as a unit-test helper)
// surfaces here instead of inside the route assertions.
describe("documentChunkStore helper", () => {
  it("_createMemoryChunkStore yields a fresh store each call", () => {
    const a = _createMemoryChunkStore();
    const b = _createMemoryChunkStore();
    expect(a).not.toBe(b);
  });
});
