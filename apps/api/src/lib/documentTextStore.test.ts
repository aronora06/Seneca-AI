import { describe, it, expect } from "vitest";

import type { DocumentPageText } from "@seneca/shared";

import { documentTextStore } from "./documentTextStore.js";

const userId = "user-text-store";
const sessionId = "session-text-store";

const pages: DocumentPageText[] = [
  { page: 1, text: "Cover page about Seneca the Younger.", charCount: 37 },
  { page: 2, text: "Letters on Stoic ethics and friendship.", charCount: 39 },
  { page: 3, text: "De Brevitate Vitae fragments.", charCount: 30 },
];

describe("documentTextStore (memory)", () => {
  it("put + getAll round-trip", async () => {
    await documentTextStore.put(userId, sessionId, "doc-rt", pages);
    const got = await documentTextStore.getAll(userId, sessionId, "doc-rt");
    expect(got).toEqual(pages);
  });

  it("getAll returns null when no extraction stored", async () => {
    const got = await documentTextStore.getAll(userId, sessionId, "no-such");
    expect(got).toBeNull();
  });

  it("getPage returns the matching page", async () => {
    await documentTextStore.put(userId, sessionId, "doc-page", pages);
    const p2 = await documentTextStore.getPage(userId, sessionId, "doc-page", 2);
    expect(p2!.text).toContain("Stoic");
  });

  it("getPage returns null for out-of-range pages", async () => {
    await documentTextStore.put(userId, sessionId, "doc-bad", pages);
    expect(
      await documentTextStore.getPage(userId, sessionId, "doc-bad", 99),
    ).toBeNull();
  });

  it("put replaces prior pages rather than appending", async () => {
    await documentTextStore.put(userId, sessionId, "doc-repl", pages);
    await documentTextStore.put(userId, sessionId, "doc-repl", [
      { page: 1, text: "Replaced content.", charCount: 17 },
    ]);
    const all = await documentTextStore.getAll(userId, sessionId, "doc-repl");
    expect(all).toHaveLength(1);
    expect(all![0]!.text).toBe("Replaced content.");
  });

  it("delete drops every page", async () => {
    await documentTextStore.put(userId, sessionId, "doc-del", pages);
    await documentTextStore.delete(userId, sessionId, "doc-del");
    expect(
      await documentTextStore.getAll(userId, sessionId, "doc-del"),
    ).toBeNull();
  });

  it("deleteForSession wipes every page under the session prefix", async () => {
    const u = "user-sweep";
    const s1 = "session-sweep-a";
    const s2 = "session-sweep-b";
    await documentTextStore.put(u, s1, "doc-1", pages);
    await documentTextStore.put(u, s1, "doc-2", pages);
    await documentTextStore.put(u, s2, "doc-3", pages);
    await documentTextStore.deleteForSession(u, s1);
    expect(await documentTextStore.getAll(u, s1, "doc-1")).toBeNull();
    expect(await documentTextStore.getAll(u, s1, "doc-2")).toBeNull();
    // Sibling session untouched.
    expect(await documentTextStore.getAll(u, s2, "doc-3")).not.toBeNull();
  });
});
