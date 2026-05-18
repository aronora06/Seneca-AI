import { describe, it, expect } from "vitest";

import type {
  DocumentRecord,
  DocumentsState,
  TranscriptMessage,
} from "@seneca/shared";

import { _internals } from "./chat.js";
import { documentTextStore } from "../lib/documentTextStore.js";

const {
  buildAnthropicMessages,
  clampPage,
  clampMaxChars,
  clampTopK,
  resolveDocumentList,
  resolveDocumentSearch,
} = _internals;

// ── clamps ───────────────────────────────────────────────────────────────

describe("clampPage", () => {
  it("returns the value when within bounds", () => {
    expect(clampPage(5, 10)).toBe(5);
  });
  it("clamps to 1 below the floor", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-3, 10)).toBe(1);
  });
  it("clamps to pageCount above the ceiling", () => {
    expect(clampPage(100, 10)).toBe(10);
  });
  it("floors fractional pages", () => {
    expect(clampPage(2.9, 10)).toBe(2);
  });
  it("permits any positive page when pageCount is 0 (legacy records)", () => {
    expect(clampPage(7, 0)).toBe(7);
    expect(clampPage(0, 0)).toBe(1);
  });
});

describe("clampMaxChars", () => {
  it("defaults to 12000 when not finite", () => {
    expect(clampMaxChars(undefined)).toBe(12_000);
    expect(clampMaxChars("abc")).toBe(12_000);
    expect(clampMaxChars(Number.NaN)).toBe(12_000);
  });
  it("clamps to floor of 500", () => {
    expect(clampMaxChars(100)).toBe(500);
  });
  it("clamps to ceiling of 30000", () => {
    expect(clampMaxChars(99_999)).toBe(30_000);
  });
  it("accepts in-range values, flooring", () => {
    expect(clampMaxChars(5_000)).toBe(5_000);
    expect(clampMaxChars(1_234.7)).toBe(1_234);
  });
});

describe("clampTopK", () => {
  it("defaults to 5", () => {
    expect(clampTopK(undefined)).toBe(5);
    expect(clampTopK("garbage")).toBe(5);
  });
  it("clamps to 1..20", () => {
    expect(clampTopK(0)).toBe(1);
    expect(clampTopK(-3)).toBe(1);
    expect(clampTopK(1_000)).toBe(20);
  });
  it("accepts in-range values, flooring", () => {
    expect(clampTopK(7)).toBe(7);
    expect(clampTopK(3.9)).toBe(3);
  });
});

// ── buildAnthropicMessages ───────────────────────────────────────────────

describe("buildAnthropicMessages", () => {
  const baseUser: TranscriptMessage = {
    id: "u1",
    role: "user",
    text: "hello",
    ts: new Date().toISOString(),
  };

  const baseSeneca: TranscriptMessage = {
    id: "s1",
    role: "seneca",
    text: "hi there",
    ts: new Date().toISOString(),
  };

  it("strips system entries from the transcript", () => {
    const out = buildAnthropicMessages(
      [
        baseUser,
        {
          id: "sys",
          role: "system",
          text: "",
          ts: new Date().toISOString(),
          notice: { kind: "error", message: "boom" },
        },
        baseSeneca,
      ],
      [],
      null,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.role).toBe("user");
    expect(out[1]!.role).toBe("assistant");
  });

  it("emits user as `user` and seneca as `assistant`", () => {
    const out = buildAnthropicMessages([baseUser, baseSeneca], [], null);
    expect(out[0]!.role).toBe("user");
    expect(out[1]!.role).toBe("assistant");
  });

  it("wraps user text in a content array with a single text block", () => {
    const out = buildAnthropicMessages([baseUser], [], null);
    expect(out[0]!.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("attaches image as a content block on the last user turn only", () => {
    const out = buildAnthropicMessages(
      [baseUser, baseSeneca, { ...baseUser, id: "u2", text: "look at this" }],
      [],
      {
        base64: "AAAA",
        mimeType: "image/png",
      },
    );
    // Last message (index 2) is the user follow-up; its content should have image+text.
    const last = out[2]!;
    expect(last.role).toBe("user");
    expect(last.content).toHaveLength(2);
    expect(last.content[0]!.type).toBe("image");
    expect(last.content[1]!.type).toBe("text");
    // The first user message should NOT have an image attached.
    const first = out[0]!;
    expect(first.content.every((c) => c.type !== "image")).toBe(true);
  });

  it("attaches prior toolResults to the last user turn", () => {
    const out = buildAnthropicMessages(
      [baseUser, baseSeneca, { ...baseUser, id: "u2", text: "follow up" }],
      [
        { toolUseId: "tu_1", ok: true, output: { ok: true } },
        { toolUseId: "tu_2", ok: false, error: "missing param" },
      ],
      null,
    );
    const last = out[2]!;
    // First two content blocks should be tool_results, last is the user text.
    expect(last.content[0]!.type).toBe("tool_result");
    expect(last.content[1]!.type).toBe("tool_result");
    expect(last.content[last.content.length - 1]!.type).toBe("text");
  });

  it("emits persisted assistant tool_use blocks as assistant content", () => {
    const senecaWithTools: TranscriptMessage = {
      ...baseSeneca,
      tools: [
        { id: "tu_a", name: "map_fly_to", input: { lat: 1, lng: 2 } },
        { id: "tu_b", name: "web_navigate", input: { url: "https://x" } },
      ],
    };
    const out = buildAnthropicMessages(
      [baseUser, senecaWithTools, { ...baseUser, id: "u2", text: "next" }],
      [],
      null,
    );
    const assistant = out[1]!;
    expect(assistant.role).toBe("assistant");
    expect(assistant.content[0]!.type).toBe("text");
    expect(assistant.content[1]!.type).toBe("tool_use");
    expect(assistant.content[2]!.type).toBe("tool_use");
    const tu0 = assistant.content[1] as {
      type: "tool_use";
      id: string;
      name: string;
    };
    expect(tu0.id).toBe("tu_a");
    expect(tu0.name).toBe("map_fly_to");
  });

  it("synthesises tool_result blocks on the user turn that follows a tools turn", () => {
    const senecaWithTools: TranscriptMessage = {
      ...baseSeneca,
      tools: [
        { id: "tu_a", name: "map_fly_to", input: {}, ok: true },
        { id: "tu_b", name: "web_navigate", input: {}, ok: false, error: "blocked" },
      ],
    };
    const out = buildAnthropicMessages(
      [baseUser, senecaWithTools, { ...baseUser, id: "u2", text: "next" }],
      [],
      null,
    );
    const userTurn = out[2]!;
    expect(userTurn.role).toBe("user");
    expect(userTurn.content[0]!.type).toBe("tool_result");
    expect(userTurn.content[1]!.type).toBe("tool_result");
    const tr0 = userTurn.content[0] as {
      type: "tool_result";
      tool_use_id: string;
      is_error?: boolean;
      content: string;
    };
    const tr1 = userTurn.content[1] as {
      type: "tool_result";
      tool_use_id: string;
      is_error?: boolean;
      content: string;
    };
    expect(tr0.tool_use_id).toBe("tu_a");
    expect(tr0.is_error).toBe(false);
    expect(tr1.tool_use_id).toBe("tu_b");
    expect(tr1.is_error).toBe(true);
    expect(tr1.content).toMatch(/blocked/);
  });

  it("live toolResults override the synthesised outcome by tool_use_id", () => {
    const senecaWithTools: TranscriptMessage = {
      ...baseSeneca,
      tools: [{ id: "tu_a", name: "map_fly_to", input: {}, ok: true }],
    };
    const out = buildAnthropicMessages(
      [baseUser, senecaWithTools, { ...baseUser, id: "u2", text: "next" }],
      [
        { toolUseId: "tu_a", ok: false, error: "actually failed on the client" },
      ],
      null,
    );
    const userTurn = out[2]!;
    const tr = userTurn.content[0] as {
      type: "tool_result";
      is_error?: boolean;
      content: string;
    };
    expect(tr.is_error).toBe(true);
    expect(tr.content).toMatch(/actually failed/);
  });

  it("emits a fallback empty text block when an assistant turn has no text and no tools", () => {
    const empty: TranscriptMessage = { ...baseSeneca, text: "" };
    const out = buildAnthropicMessages([baseUser, empty], [], null);
    expect(out[1]!.content).toEqual([{ type: "text", text: "" }]);
  });
});

// ── resolveDocumentList ──────────────────────────────────────────────────

function fakeDoc(
  id: string,
  name: string,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    name,
    filename: `${name}.pdf`,
    size: 1024,
    pageCount: 10,
    currentPage: 1,
    uploadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("resolveDocumentList", () => {
  it("returns count 0 when no docs are loaded", () => {
    const empty: DocumentsState = { items: [], activeId: null };
    const json = resolveDocumentList(empty);
    const parsed = JSON.parse(json) as {
      count: number;
      activeId: string | null;
      items: unknown[];
    };
    expect(parsed.count).toBe(0);
    expect(parsed.activeId).toBeNull();
    expect(parsed.items).toEqual([]);
  });

  it("projects active flag onto exactly the activeId", () => {
    const docs: DocumentsState = {
      items: [
        fakeDoc("a", "Alpha", { textStatus: "extracted" }),
        fakeDoc("b", "Beta", { textStatus: "scanned" }),
      ],
      activeId: "b",
    };
    const parsed = JSON.parse(resolveDocumentList(docs)) as {
      count: number;
      items: Array<{ id: string; active: boolean; textStatus: string }>;
    };
    expect(parsed.count).toBe(2);
    expect(parsed.items.find((i) => i.id === "a")!.active).toBe(false);
    expect(parsed.items.find((i) => i.id === "b")!.active).toBe(true);
  });

  it("defaults textStatus to 'pending' when missing", () => {
    const docs: DocumentsState = {
      items: [fakeDoc("legacy", "Legacy")],
      activeId: null,
    };
    const parsed = JSON.parse(resolveDocumentList(docs)) as {
      items: Array<{ textStatus: string }>;
    };
    expect(parsed.items[0]!.textStatus).toBe("pending");
  });
});

// ── resolveDocumentSearch ────────────────────────────────────────────────

describe("resolveDocumentSearch", () => {
  const u = "user-search";
  const s = "session-search";

  const philosophy = fakeDoc("phil", "Philosophy", { textStatus: "extracted" });
  const archives = fakeDoc("arch", "Archives", { textStatus: "extracted" });
  const scanned = fakeDoc("scan", "Scanned doc");

  const docs: DocumentsState = {
    items: [philosophy, archives, scanned],
    activeId: philosophy.id,
  };

  it("rejects empty / non-string queries", async () => {
    const r = await resolveDocumentSearch({}, u, s, docs);
    expect(r.isError).toBe(true);
    const parsed = JSON.parse(r.content as string) as { error: string };
    expect(parsed.error).toMatch(/non-empty/);
  });

  it("reports 'no docs' when the session is empty", async () => {
    const r = await resolveDocumentSearch(
      { query: "anything" },
      u,
      s,
      { items: [], activeId: null },
    );
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content as string) as { count: number; note?: string };
    expect(parsed.count).toBe(0);
    expect(parsed.note).toMatch(/No documents/);
  });

  it("reports 'unknown id' when document_id is given but not present", async () => {
    const r = await resolveDocumentSearch(
      { query: "anything", document_id: "not-there" },
      u,
      s,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as { note?: string; count: number };
    expect(parsed.count).toBe(0);
    expect(parsed.note).toMatch(/not-there/);
  });

  it("ranks pages by hit count, returns top_k, includes snippet", async () => {
    await documentTextStore.put(u, s, philosophy.id, [
      {
        page: 1,
        text: "Seneca writes that virtue alone suffices. Virtue is action.",
        charCount: 58,
      },
      {
        page: 2,
        text: "Letters discuss fortune; virtue appears once.",
        charCount: 44,
      },
    ]);
    await documentTextStore.put(u, s, archives.id, [
      {
        page: 1,
        text: "On friendship and ethics, with no occurrence of the word v-irtue.",
        charCount: 64,
      },
    ]);

    const r = await resolveDocumentSearch(
      { query: "virtue", top_k: 5 },
      u,
      s,
      docs,
    );
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content as string) as {
      query: string;
      count: number;
      total_matches: number;
      hits: Array<{
        documentId: string;
        page: number;
        snippet: string;
        score: number;
      }>;
      skipped: Array<{ documentId: string; reason: string }>;
      searched: number;
    };
    expect(parsed.query).toBe("virtue");
    expect(parsed.hits.length).toBeGreaterThan(0);
    expect(parsed.hits[0]!.score).toBeGreaterThanOrEqual(2); // page 1 has 2 hits
    expect(parsed.hits[0]!.page).toBe(1);
    expect(parsed.hits[0]!.snippet.toLowerCase()).toContain("virtue");
    expect(parsed.searched).toBe(2);
    // Scanned doc never had text extracted → reported under skipped.
    expect(parsed.skipped.some((s) => s.documentId === scanned.id)).toBe(true);
  });

  it("respects top_k and clamps it", async () => {
    await documentTextStore.put(u, s, philosophy.id, [
      { page: 1, text: "alpha alpha alpha", charCount: 17 },
      { page: 2, text: "alpha alpha", charCount: 11 },
      { page: 3, text: "alpha", charCount: 5 },
    ]);
    const r = await resolveDocumentSearch(
      { query: "alpha", top_k: 1 },
      u,
      s,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as { hits: unknown[] };
    expect(parsed.hits).toHaveLength(1);
  });

  it("scopes the search when document_id is provided", async () => {
    await documentTextStore.put(u, s, philosophy.id, [
      { page: 1, text: "beta is present", charCount: 15 },
    ]);
    await documentTextStore.put(u, s, archives.id, [
      { page: 1, text: "beta beta beta", charCount: 14 },
    ]);
    const r = await resolveDocumentSearch(
      { query: "beta", document_id: archives.id },
      u,
      s,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as {
      hits: Array<{ documentId: string }>;
      searched: number;
    };
    expect(parsed.searched).toBe(1);
    expect(parsed.hits.every((h) => h.documentId === archives.id)).toBe(true);
  });

  it("is case-insensitive", async () => {
    await documentTextStore.put(u, s, philosophy.id, [
      { page: 1, text: "EQUANIMITY is the goal.", charCount: 23 },
    ]);
    const r = await resolveDocumentSearch(
      { query: "equanimity" },
      u,
      s,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as {
      hits: Array<{ page: number }>;
    };
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]!.page).toBe(1);
  });
});
