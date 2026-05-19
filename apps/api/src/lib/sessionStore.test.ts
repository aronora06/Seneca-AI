import { describe, it, expect, beforeEach } from "vitest";

import type { SessionRecord } from "@seneca/shared";
import { DEFAULT_DIAGRAMS_STATE } from "@seneca/shared";
import {
  DEFAULT_DOCUMENTS_STATE,
  DEFAULT_MAP_STATE,
  DEFAULT_WEB_STATE,
} from "@seneca/shared";

import { sessionStore, summarizeSession } from "./sessionStore.js";

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

  it("updateDiagrams persists draw.io xml", async () => {
    const xml =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Hi" vertex="1" parent="1"/></root></mxGraphModel>';
    await sessionStore.updateDiagrams(aSessionId, userA, { xml });
    const row = await sessionStore.getFullById(aSessionId, userA);
    expect(row!.diagrams.xml).toBe(xml);
  });

  it("delete by non-owner silently no-ops", async () => {
    await sessionStore.delete(aSessionId, userB);
    const stillThere = await sessionStore.getFullById(aSessionId, userA);
    expect(stillThere).not.toBeNull();
  });

  it("getById returns id/web/documents/diagrams only", async () => {
    const slim = await sessionStore.getById(aSessionId, userA);
    expect(slim).not.toBeNull();
    expect(slim!.id).toBe(aSessionId);
    expect(slim!.web).toBeDefined();
    expect(slim!.documents).toBeDefined();
    expect(slim!.diagrams).toBeDefined();
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

  it("setPinned flips the pinned flag and survives a re-read", async () => {
    await sessionStore.setPinned(aSessionId, userA, true);
    const after = await sessionStore.getFullById(aSessionId, userA);
    expect(after!.pinned).toBe(true);

    await sessionStore.setPinned(aSessionId, userA, false);
    const after2 = await sessionStore.getFullById(aSessionId, userA);
    expect(after2!.pinned).toBe(false);
  });

  it("setPinned is a no-op when called by a non-owner", async () => {
    await sessionStore.setPinned(aSessionId, userB, true);
    const after = await sessionStore.getFullById(aSessionId, userA);
    expect(after!.pinned === true).toBe(false);
  });

  it("list surfaces lastUserText, documentCount, and tabs", async () => {
    await sessionStore.updateTranscript(aSessionId, userA, [
      {
        id: "m1",
        role: "user",
        text: "What is Spinoza's view on substance?",
        ts: new Date().toISOString(),
      },
      {
        id: "m2",
        role: "seneca",
        text: "He defines substance as that which is in itself...",
        ts: new Date().toISOString(),
      },
    ]);
    await sessionStore.updateDocuments(aSessionId, userA, {
      items: [
        {
          id: "doc-1",
          name: "Letters",
          filename: "letters.pdf",
          size: 1024,
          pageCount: 200,
          currentPage: 47,
          uploadedAt: new Date().toISOString(),
        },
      ],
      activeId: "doc-1",
    });
    const list = await sessionStore.list(userA);
    const summary = list.find((s) => s.id === aSessionId)!;
    expect(summary.lastUserText).toBe(
      "What is Spinoza's view on substance?",
    );
    expect(summary.documentCount).toBe(1);
    expect(summary.tabs).toEqual(expect.arrayContaining(["documents"]));
    expect(summary.lastMessageAt).toBeTruthy();
  });

  it("list sorts pinned sessions to the top", async () => {
    const second = await sessionStore.create(userA, "Second");
    await sessionStore.setPinned(second.id, userA, true);
    const list = await sessionStore.list(userA);
    expect(list[0]!.id).toBe(second.id);
    expect(list[0]!.pinned).toBe(true);
  });
});

describe("summarizeSession", () => {
  const base: SessionRecord = {
    id: "row-1",
    user_id: "u1",
    name: "Test",
    transcript: [],
    whiteboard: { elements: [] },
    diagrams: { ...DEFAULT_DIAGRAMS_STATE },
    map: { ...DEFAULT_MAP_STATE },
    web: { ...DEFAULT_WEB_STATE },
    documents: { ...DEFAULT_DOCUMENTS_STATE },
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
  };

  it("derives empty fields from an empty session", () => {
    const out = summarizeSession(base);
    expect(out.lastUserText).toBeNull();
    expect(out.lastMessageAt).toBeNull();
    expect(out.documentCount).toBe(0);
    expect(out.tabs).toEqual([]);
    expect(out.pinned).toBe(false);
  });

  it("prefers the most recent USER message for the snippet", () => {
    const out = summarizeSession({
      ...base,
      transcript: [
        { id: "1", role: "user", text: "first ask", ts: "2024-01-01T00:00:00Z" },
        {
          id: "2",
          role: "seneca",
          text: "long answer with thoughts",
          ts: "2024-01-01T00:00:01Z",
        },
        {
          id: "3",
          role: "user",
          text: "follow-up question",
          ts: "2024-01-01T00:00:02Z",
        },
        {
          id: "4",
          role: "seneca",
          text: "another answer",
          ts: "2024-01-01T00:00:03Z",
        },
      ],
    });
    expect(out.lastUserText).toBe("follow-up question");
    expect(out.lastMessageAt).toBe("2024-01-01T00:00:03Z");
  });

  it("truncates snippets longer than 140 chars on a word boundary", () => {
    const longText = "word ".repeat(40); // 200 chars
    const out = summarizeSession({
      ...base,
      transcript: [
        { id: "1", role: "user", text: longText, ts: "2024-01-01T00:00:00Z" },
      ],
    });
    expect(out.lastUserText!.length).toBeLessThanOrEqual(141);
    expect(out.lastUserText!.endsWith("…")).toBe(true);
  });

  it("flags every canvas tab that was touched", () => {
    const out = summarizeSession({
      ...base,
      transcript: [
        { id: "1", role: "user", text: "hi", ts: "2024-01-01T00:00:00Z" },
      ],
      documents: {
        items: [
          {
            id: "d",
            name: "Doc",
            filename: "doc.pdf",
            size: 1,
            pageCount: 1,
            currentPage: 1,
            uploadedAt: "2024-01-01T00:00:00Z",
          },
        ],
        activeId: "d",
      },
      web: { url: "https://example.com", history: [], historyIndex: -1 },
      map: { ...DEFAULT_MAP_STATE, pins: [{ id: "p", lat: 0, lng: 0 }] },
      whiteboard: { elements: [{ id: "e" }] },
    });
    expect(out.tabs).toEqual([
      "documents",
      "web",
      "map",
      "whiteboard",
    ]);
  });

  it("flags diagrams tab when diagram xml has content", () => {
    const xml = `${DEFAULT_DIAGRAMS_STATE.xml.replace(
      "</root>",
      '<mxCell id="2" value="Node" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell></root>',
    )}`;
    const out = summarizeSession({
      ...base,
      diagrams: { xml },
    });
    expect(out.tabs).toContain("diagrams");
  });

  it("skips empty-text user messages when picking the snippet", () => {
    const out = summarizeSession({
      ...base,
      transcript: [
        {
          id: "1",
          role: "user",
          text: "real question",
          ts: "2024-01-01T00:00:00Z",
        },
        { id: "2", role: "user", text: "   ", ts: "2024-01-01T00:00:01Z" },
      ],
    });
    expect(out.lastUserText).toBe("real question");
  });

  it("collapses whitespace inside the snippet", () => {
    const out = summarizeSession({
      ...base,
      transcript: [
        {
          id: "1",
          role: "user",
          text: "What\n\nabout\t\tSpinoza?",
          ts: "2024-01-01T00:00:00Z",
        },
      ],
    });
    expect(out.lastUserText).toBe("What about Spinoza?");
  });
});
