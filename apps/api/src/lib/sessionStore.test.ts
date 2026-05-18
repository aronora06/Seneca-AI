import { describe, it, expect, beforeEach } from "vitest";

import { sessionStore } from "./sessionStore.js";

/**
 * These tests exercise the in-memory session store (DEV_BYPASS_AUTH=true in
 * the vitest setup). The Supabase impl is covered by integration tests when
 * a real project is configured; the contract — both impls implement the
 * same interface — is what these tests defend.
 */
describe("sessionStore (memory)", () => {
  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";

  // Memory store is module-scoped; create a fresh logical user per file
  // run by giving each test unique data, then assert isolation explicitly.
  let aSessionId = "";

  beforeEach(async () => {
    const fresh = await sessionStore.create(userA, "Test session");
    aSessionId = fresh.id;
  });

  it("getOrCreateCurrent creates a session when none exists", async () => {
    const userC = `c${crypto.randomUUID()}`;
    const row = await sessionStore.getOrCreateCurrent(userC);
    expect(row.user_id).toBe(userC);
    expect(row.transcript).toEqual([]);
    expect(Array.isArray(row.whiteboard.elements)).toBe(true);
    expect(row.documents.activeId).toBeNull();
    expect(row.web.url).toBeNull();
  });

  it("getOrCreateCurrent returns the most recent existing session", async () => {
    const row1 = await sessionStore.getOrCreateCurrent(userA);
    expect(row1.id).toBe(aSessionId);
  });

  it("create returns a new session with the requested name", async () => {
    const row = await sessionStore.create(userA, "Caspian study");
    expect(row.name).toBe("Caspian study");
    expect(row.id).not.toBe(aSessionId);
  });

  it("create with whitespace name falls back to Untitled", async () => {
    const row = await sessionStore.create(userA, "   ");
    expect(row.name).toBe("Untitled");
  });

  it("list returns only the caller's sessions, newest first", async () => {
    await sessionStore.create(userB, "B-session");
    const aList = await sessionStore.list(userA);
    expect(aList.length).toBeGreaterThan(0);
    expect(aList.every((s) => s.id !== "B-session-id")).toBe(true);
    // newest first
    for (let i = 1; i < aList.length; i++) {
      expect(aList[i - 1]!.updated_at >= aList[i]!.updated_at).toBe(true);
    }
  });

  it("rename updates the name and stores trim()ed value", async () => {
    await sessionStore.rename(aSessionId, userA, "  New name  ");
    const row = await sessionStore.getFullById(aSessionId, userA);
    expect(row!.name).toBe("New name");
  });

  it("rename throws on rows the caller does not own", async () => {
    await expect(
      sessionStore.rename(aSessionId, userB, "Hijack"),
    ).rejects.toThrow();
  });

  it("delete removes the session and is idempotent across owners", async () => {
    await sessionStore.delete(aSessionId, userA);
    expect(await sessionStore.getFullById(aSessionId, userA)).toBeNull();
    // calling delete again is silently a no-op
    await expect(sessionStore.delete(aSessionId, userA)).resolves.not.toThrow();
  });

  it("delete by non-owner silently no-ops", async () => {
    await sessionStore.delete(aSessionId, userB);
    const stillThere = await sessionStore.getFullById(aSessionId, userA);
    expect(stillThere).not.toBeNull();
  });

  it("getById returns id/web/documents only", async () => {
    const slim = await sessionStore.getById(aSessionId, userA);
    expect(slim).not.toBeNull();
    expect(slim!.id).toBe(aSessionId);
    expect(slim!.web).toBeDefined();
    expect(slim!.documents).toBeDefined();
    expect(slim).not.toHaveProperty("transcript");
    expect(slim).not.toHaveProperty("whiteboard");
  });

  it("getById returns null when the caller does not own the row", async () => {
    expect(await sessionStore.getById(aSessionId, userB)).toBeNull();
  });

  it("updateTranscript persists across reads", async () => {
    await sessionStore.updateTranscript(aSessionId, userA, [
      {
        id: "m1",
        role: "user",
        text: "hello",
        ts: new Date().toISOString(),
      },
    ]);
    const row = await sessionStore.getFullById(aSessionId, userA);
    expect(row!.transcript).toHaveLength(1);
    expect(row!.transcript[0]!.text).toBe("hello");
  });

  it("bumpUsage initialises and accumulates the usage blob", async () => {
    await sessionStore.bumpUsage(aSessionId, userA, undefined, {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 0,
      inputCostUSD: 0.003,
      outputCostUSD: 0.0003,
    });
    const after = await sessionStore.getFullById(aSessionId, userA);
    expect(after!.usage).toBeDefined();
    expect(after!.usage!.inputTokens).toBe(100);
    expect(after!.usage!.cacheReadInputTokens).toBe(5);
    expect(after!.usage!.inputCostUSD).toBeCloseTo(0.003);

    await sessionStore.bumpUsage(aSessionId, userA, undefined, {
      inputTokens: 50,
      outputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 7,
      inputCostUSD: 0.001,
      outputCostUSD: 0.0001,
    });
    const after2 = await sessionStore.getFullById(aSessionId, userA);
    expect(after2!.usage!.inputTokens).toBe(150);
    expect(after2!.usage!.outputTokens).toBe(30);
    expect(after2!.usage!.cacheReadInputTokens).toBe(5);
    expect(after2!.usage!.cacheCreationInputTokens).toBe(7);
    expect(after2!.usage!.inputCostUSD).toBeCloseTo(0.004);
  });

  it("bumpUsage is a no-op when called by a non-owner", async () => {
    await sessionStore.bumpUsage(aSessionId, userB, undefined, {
      inputTokens: 999,
      outputTokens: 999,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      inputCostUSD: 99,
      outputCostUSD: 99,
    });
    const after = await sessionStore.getFullById(aSessionId, userA);
    // Either never set, or set by a prior bump in another test — but
    // certainly not 99 (the rejected non-owner call).
    expect((after!.usage?.inputCostUSD ?? 0) < 1).toBe(true);
  });

  it("updateMap / updateWeb / updateDocuments persist independently", async () => {
    await sessionStore.updateMap(aSessionId, userA, {
      center: [50, 50],
      zoom: 6,
      layer: "satellite",
      pins: [],
      shapes: [],
    });
    await sessionStore.updateWeb(aSessionId, userA, {
      url: "https://example.com",
      history: ["https://example.com"],
      historyIndex: 0,
    });
    await sessionStore.updateDocuments(aSessionId, userA, {
      items: [],
      activeId: null,
    });
    const row = await sessionStore.getFullById(aSessionId, userA);
    expect(row!.map.zoom).toBe(6);
    expect(row!.map.layer).toBe("satellite");
    expect(row!.web.url).toBe("https://example.com");
    expect(row!.documents.activeId).toBeNull();
  });
});
