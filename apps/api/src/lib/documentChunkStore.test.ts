import { describe, it, expect, beforeEach } from "vitest";

import type { DocumentChunkRow } from "@seneca/shared";

import { _createMemoryChunkStore } from "./documentChunkStore.js";

const ZERO = new Array(1024).fill(0);
function vec(...dims: number[]): number[] {
  // Build a 1024-dim vector with the first N components set, padded with 0s.
  const out = [...dims, ...ZERO].slice(0, 1024);
  return out;
}

function row(
  page: number,
  chunkIndex: number,
  text: string,
  embedding: number[],
): DocumentChunkRow {
  return { page, chunkIndex, text, embedding };
}

const userId = "user-cs";
const sessionId = "session-cs";

let store: ReturnType<typeof _createMemoryChunkStore>;

beforeEach(() => {
  store = _createMemoryChunkStore();
});

describe("documentChunkStore (memory) — put + topK", () => {
  it("returns empty when nothing is indexed", async () => {
    const hits = await store.topK(userId, sessionId, vec(1, 0), 5);
    expect(hits).toEqual([]);
  });

  it("ranks identical-direction vectors first", async () => {
    await store.put(userId, sessionId, "doc-a", [
      row(1, 0, "matches the query closely", vec(1, 0)),
      row(2, 1, "tangentially related", vec(0, 1)),
      row(3, 2, "opposite direction", vec(-1, 0)),
    ]);
    const hits = await store.topK(userId, sessionId, vec(1, 0), 3);
    expect(hits).toHaveLength(3);
    expect(hits[0]!.chunkIndex).toBe(0); // same direction
    expect(hits[0]!.score).toBeCloseTo(1, 4);
    expect(hits[2]!.chunkIndex).toBe(2); // opposite direction
    expect(hits[2]!.score).toBeCloseTo(0, 4);
  });

  it("respects the topK cap", async () => {
    await store.put(userId, sessionId, "doc-a", [
      row(1, 0, "a", vec(1, 0)),
      row(2, 1, "b", vec(0.9, 0.1)),
      row(3, 2, "c", vec(0.8, 0.2)),
      row(4, 3, "d", vec(0.7, 0.3)),
    ]);
    const hits = await store.topK(userId, sessionId, vec(1, 0), 2);
    expect(hits).toHaveLength(2);
  });

  it("includes documentId on every hit", async () => {
    await store.put(userId, sessionId, "doc-x", [
      row(1, 0, "alpha", vec(1, 0)),
    ]);
    await store.put(userId, sessionId, "doc-y", [
      row(1, 0, "beta", vec(0, 1)),
    ]);
    const hits = await store.topK(userId, sessionId, vec(1, 0), 5);
    const ids = new Set(hits.map((h) => h.documentId));
    expect(ids).toEqual(new Set(["doc-x", "doc-y"]));
  });

  it("filters by documentId when provided", async () => {
    await store.put(userId, sessionId, "doc-x", [
      row(1, 0, "alpha", vec(1, 0)),
    ]);
    await store.put(userId, sessionId, "doc-y", [
      row(1, 0, "beta", vec(1, 0)),
    ]);
    const hits = await store.topK(userId, sessionId, vec(1, 0), 5, "doc-x");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.documentId).toBe("doc-x");
  });

  it("isolates chunks across sessions", async () => {
    await store.put(userId, "s1", "doc-iso", [
      row(1, 0, "a", vec(1, 0)),
    ]);
    const hits = await store.topK(userId, "s2", vec(1, 0), 5);
    expect(hits).toEqual([]);
  });

  it("isolates chunks across users", async () => {
    await store.put("user-a", sessionId, "doc-iso", [
      row(1, 0, "a", vec(1, 0)),
    ]);
    const hits = await store.topK("user-b", sessionId, vec(1, 0), 5);
    expect(hits).toEqual([]);
  });
});

describe("documentChunkStore (memory) — put semantics", () => {
  it("put replaces prior chunks rather than appending", async () => {
    await store.put(userId, sessionId, "doc-r", [
      row(1, 0, "first", vec(1, 0)),
      row(2, 1, "second", vec(0, 1)),
    ]);
    await store.put(userId, sessionId, "doc-r", [
      row(1, 0, "fresh", vec(1, 0)),
    ]);
    const hits = await store.topK(userId, sessionId, vec(1, 0), 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toBe("fresh");
  });
});

describe("documentChunkStore (memory) — delete", () => {
  it("delete removes a single document's chunks", async () => {
    await store.put(userId, sessionId, "doc-a", [
      row(1, 0, "a", vec(1, 0)),
    ]);
    await store.put(userId, sessionId, "doc-b", [
      row(1, 0, "b", vec(0, 1)),
    ]);
    await store.delete(userId, sessionId, "doc-a");
    const hits = await store.topK(userId, sessionId, vec(1, 0), 5);
    expect(hits.map((h) => h.documentId)).toEqual(["doc-b"]);
  });

  it("deleteForSession wipes every doc in the session", async () => {
    await store.put(userId, sessionId, "doc-a", [
      row(1, 0, "a", vec(1, 0)),
    ]);
    await store.put(userId, sessionId, "doc-b", [
      row(1, 0, "b", vec(0, 1)),
    ]);
    await store.put(userId, "other-session", "doc-c", [
      row(1, 0, "c", vec(0, 1)),
    ]);
    await store.deleteForSession(userId, sessionId);
    expect(
      await store.topK(userId, sessionId, vec(1, 0), 5),
    ).toEqual([]);
    // Other session is untouched.
    expect(
      (await store.topK(userId, "other-session", vec(0, 1), 5)).length,
    ).toBe(1);
  });
});
