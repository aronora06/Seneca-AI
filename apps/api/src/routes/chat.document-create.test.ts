/**
 * Tests for the Phase 6 `document_create` resolver.
 *
 * Covers input validation, persistence, sidebar registration, in-loop
 * activation handoff, and the indexing fallback when Voyage isn't
 * configured. The resolver is server-fulfilled — these tests exercise
 * the same code path the agent loop hits during `tool_use` dispatch.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DocumentsState } from "@seneca/shared";

import { _internals } from "./chat.js";
import { documentChunkStore } from "../lib/documentChunkStore.js";
import { documentStore } from "../lib/documentStorage.js";
import { documentTextStore } from "../lib/documentTextStore.js";
import { sessionStore } from "../lib/sessionStore.js";

const { resolveDocumentCreate } = _internals;

const userId = "11111111-1111-1111-1111-111111111111";
let sessionId: string;

const emptyDocs: DocumentsState = { items: [], activeId: null };

async function freshSession(): Promise<string> {
  const created = await sessionStore.create(userId, "Phase 6 tests");
  return created.id;
}

describe("resolveDocumentCreate", () => {
  beforeEach(async () => {
    sessionId = await freshSession();
  });

  afterEach(async () => {
    // Best-effort cleanup. The memory store auto-resets per-process but
    // we still wipe the per-session text and chunks so a stray failure
    // doesn't leak state into the next test.
    await documentTextStore.deleteForSession(userId, sessionId).catch(() => undefined);
    await documentChunkStore.deleteForSession(userId, sessionId).catch(() => undefined);
    await documentStore.deleteForSession(userId, sessionId).catch(() => undefined);
  });

  it("rejects a missing title", async () => {
    const result = await resolveDocumentCreate(
      { content: "body" },
      userId,
      sessionId,
      undefined,
      emptyDocs,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/title/i);
  });

  it("rejects an empty content body", async () => {
    const result = await resolveDocumentCreate(
      { title: "Outline", content: "   " },
      userId,
      sessionId,
      undefined,
      emptyDocs,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/content/i);
  });

  it("rejects an unsupported format", async () => {
    const result = await resolveDocumentCreate(
      { title: "x", content: "y", format: "html" },
      userId,
      sessionId,
      undefined,
      emptyDocs,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/format/i);
  });

  it("rejects content beyond the cap", async () => {
    const result = await resolveDocumentCreate(
      { title: "x", content: "a".repeat(100_000) },
      userId,
      sessionId,
      undefined,
      emptyDocs,
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toMatch(/too long/i);
  });

  it("rejects a too-long title", async () => {
    const result = await resolveDocumentCreate(
      { title: "x".repeat(200), content: "ok" },
      userId,
      sessionId,
      undefined,
      emptyDocs,
    );
    expect(result.isError).toBe(true);
  });

  it("persists a new ai-created markdown document with text rows", async () => {
    const result = await resolveDocumentCreate(
      {
        title: "Summary of Stoicism",
        content: "# Stoicism\n\nA practical philosophy.",
      },
      userId,
      sessionId,
      undefined,
      emptyDocs,
    );
    expect(result.isError).toBe(false);
    expect(result.created).toBeDefined();
    const { documentId, documents } = result.created!;
    expect(documents.activeId).toBe(documentId);

    const record = documents.items.find((d) => d.id === documentId);
    expect(record).toBeDefined();
    expect(record!.origin).toBe("ai-created");
    expect(record!.renderHint).toBe("markdown");
    expect(record!.mime).toBe("text/markdown");
    expect(record!.textStatus).toBe("extracted");

    const pages = await documentTextStore.getAll(userId, sessionId, documentId);
    expect(pages).not.toBeNull();
    expect(pages!.length).toBeGreaterThanOrEqual(1);
    expect(pages!.map((p) => p.text).join("\n")).toContain("Stoicism");
  });

  it("preserves prior documents and appends the new one", async () => {
    const priorDocs: DocumentsState = {
      items: [
        {
          id: "doc-existing",
          name: "Existing",
          filename: "existing.pdf",
          size: 100,
          pageCount: 1,
          currentPage: 1,
          uploadedAt: new Date().toISOString(),
          textStatus: "extracted",
        },
      ],
      activeId: "doc-existing",
    };
    const result = await resolveDocumentCreate(
      { title: "New", content: "hello" },
      userId,
      sessionId,
      undefined,
      priorDocs,
    );
    expect(result.isError).toBe(false);
    expect(result.created!.documents.items).toHaveLength(2);
    // Prior is preserved, new one is active.
    expect(result.created!.documents.items[0]!.id).toBe("doc-existing");
    expect(result.created!.documents.activeId).toBe(
      result.created!.documents.items[1]!.id,
    );
  });

  it("returns a tool_result envelope with the new id and pageCount", async () => {
    const result = await resolveDocumentCreate(
      { title: "Brief", content: "one paragraph" },
      userId,
      sessionId,
      undefined,
      emptyDocs,
    );
    const payload = JSON.parse(result.content) as {
      documentId: string;
      documentName: string;
      pageCount: number;
      indexStatus: string;
    };
    expect(payload.documentName).toBe("Brief");
    expect(payload.pageCount).toBeGreaterThanOrEqual(1);
    // Without VOYAGE_API_KEY set, indexing is "skipped". Test environment
    // never has the key configured, so this is deterministic.
    expect(["skipped", "indexed"]).toContain(payload.indexStatus);
  });
});
