/**
 * Focused test for `resolveDocumentSearch`'s vector path + substring
 * fallback. The default vitest setup leaves `VOYAGE_API_KEY` unset so
 * the substring path runs in every other test file; here we set the
 * key and stub the Voyage client + chunk store to drive the vector
 * branch deterministically.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DocumentRecord,
  DocumentsState,
  DocumentChunkHit,
} from "@seneca/shared";

const embedMock = vi.fn<(texts: string[]) => Promise<number[][]>>();
const topKMock = vi.fn<() => Promise<DocumentChunkHit[]>>();

// `env` is a `const` captured at module load. Mocking the env module
// is the cleanest way to flip `voyageApiKey` on for this test file
// without leaking the change into the rest of the suite.
vi.mock("../env.js", async () => {
  const actual = await vi.importActual<typeof import("../env.js")>(
    "../env.js",
  );
  return {
    ...actual,
    env: { ...actual.env, voyageApiKey: "test-voyage-key" },
  };
});

vi.mock("../lib/voyageEmbeddings.js", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/voyageEmbeddings.js")
  >("../lib/voyageEmbeddings.js");
  return {
    ...actual,
    embed: (texts: string[]) => embedMock(texts),
  };
});

vi.mock("../lib/documentChunkStore.js", () => ({
  documentChunkStore: {
    put: vi.fn(async () => undefined),
    topK: () => topKMock(),
    delete: vi.fn(async () => undefined),
    deleteForSession: vi.fn(async () => undefined),
  },
}));

import { _internals } from "./chat.js";
const { resolveDocumentSearch } = _internals;

function doc(
  id: string,
  name: string,
  overrides: Partial<DocumentRecord> = {},
): DocumentRecord {
  return {
    id,
    name,
    filename: `${name}.pdf`,
    size: 100,
    pageCount: 10,
    currentPage: 1,
    uploadedAt: new Date().toISOString(),
    textStatus: "extracted",
    indexStatus: "indexed",
    ...overrides,
  };
}

beforeEach(() => {
  embedMock.mockReset();
  topKMock.mockReset();
});

describe("resolveDocumentSearch — vector path", () => {
  const userId = "user-vec";
  const sessionId = "session-vec";

  it("calls embed once with the query and reports engine=vector", async () => {
    embedMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    topKMock.mockResolvedValue([
      {
        documentId: "doc-1",
        page: 5,
        chunkIndex: 0,
        text: "Seneca writes of the brevity of life and the long virtue.",
        score: 0.87,
      },
    ]);

    const docs: DocumentsState = {
      items: [doc("doc-1", "Letters")],
      activeId: "doc-1",
    };

    const r = await resolveDocumentSearch(
      { query: "brevity" },
      userId,
      sessionId,
      docs,
    );
    expect(r.isError).toBe(false);
    const parsed = JSON.parse(r.content as string) as {
      engine: string;
      hits: Array<{ documentId: string; page: number; score: number }>;
    };
    expect(parsed.engine).toBe("vector");
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]!.documentId).toBe("doc-1");
    expect(parsed.hits[0]!.page).toBe(5);
    expect(parsed.hits[0]!.score).toBeCloseTo(0.87, 2);
    expect(embedMock).toHaveBeenCalledOnce();
    expect(embedMock).toHaveBeenCalledWith(["brevity"]);
  });

  it("filters out hits whose documentId is not in scope", async () => {
    embedMock.mockResolvedValue([[1, 0]]);
    topKMock.mockResolvedValue([
      {
        documentId: "doc-1",
        page: 1,
        chunkIndex: 0,
        text: "alpha",
        score: 0.9,
      },
      {
        documentId: "doc-stale", // not in persistedDocs
        page: 1,
        chunkIndex: 0,
        text: "stale",
        score: 0.95,
      },
    ]);
    const docs: DocumentsState = {
      items: [doc("doc-1", "A")],
      activeId: "doc-1",
    };
    const r = await resolveDocumentSearch(
      { query: "alpha" },
      userId,
      sessionId,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as {
      hits: Array<{ documentId: string }>;
    };
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]!.documentId).toBe("doc-1");
  });

  it("reports docs with non-indexed status under skipped", async () => {
    embedMock.mockResolvedValue([[1, 0]]);
    topKMock.mockResolvedValue([
      {
        documentId: "doc-1",
        page: 1,
        chunkIndex: 0,
        text: "alpha",
        score: 0.9,
      },
    ]);
    const docs: DocumentsState = {
      items: [
        doc("doc-1", "Indexed"),
        doc("doc-2", "Pending", { indexStatus: "pending" }),
        doc("doc-3", "Indexing", { indexStatus: "indexing" }),
        doc("doc-4", "Failed", { indexStatus: "failed" }),
        doc("doc-5", "Skipped", { indexStatus: "skipped" }),
      ],
      activeId: "doc-1",
    };
    const r = await resolveDocumentSearch(
      { query: "alpha" },
      userId,
      sessionId,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as {
      engine: string;
      skipped: Array<{ documentId: string; reason: string }>;
    };
    expect(parsed.engine).toBe("vector");
    expect(parsed.skipped.map((s) => s.documentId).sort()).toEqual([
      "doc-2",
      "doc-3",
      "doc-4",
      "doc-5",
    ]);
    // Specific reason copy is informative.
    expect(
      parsed.skipped.find((s) => s.documentId === "doc-3")!.reason,
    ).toMatch(/Indexing in progress/);
  });

  it("falls back to substring when Voyage throws", async () => {
    embedMock.mockRejectedValue(new Error("voyage 502"));
    // documentTextStore is unmocked — there's no extracted text for any
    // of these docs, so substring fallback will report no hits but the
    // engine field still says substring.
    const docs: DocumentsState = {
      items: [doc("doc-1", "Letters")],
      activeId: "doc-1",
    };
    const r = await resolveDocumentSearch(
      { query: "anything" },
      userId,
      sessionId,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as {
      engine: string;
      vector_error: string | null;
    };
    expect(parsed.engine).toBe("substring");
    expect(parsed.vector_error).toMatch(/voyage 502/);
  });

  it("falls back to substring when topK returns zero hits", async () => {
    embedMock.mockResolvedValue([[1, 0]]);
    topKMock.mockResolvedValue([]);
    const docs: DocumentsState = {
      items: [doc("doc-1", "Letters")],
      activeId: "doc-1",
    };
    const r = await resolveDocumentSearch(
      { query: "anything" },
      userId,
      sessionId,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as { engine: string };
    expect(parsed.engine).toBe("substring");
  });

  it("skips the vector path entirely when no doc has indexStatus=indexed", async () => {
    const docs: DocumentsState = {
      items: [
        doc("doc-1", "Letters", { indexStatus: "skipped" }),
        doc("doc-2", "Pamphlet", { indexStatus: "failed" }),
      ],
      activeId: "doc-1",
    };
    const r = await resolveDocumentSearch(
      { query: "anything" },
      userId,
      sessionId,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as { engine: string };
    expect(parsed.engine).toBe("substring");
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("scopes the vector lookup to a single doc when document_id is set", async () => {
    embedMock.mockResolvedValue([[1, 0]]);
    topKMock.mockResolvedValue([
      {
        documentId: "doc-2",
        page: 1,
        chunkIndex: 0,
        text: "scoped hit",
        score: 0.7,
      },
    ]);
    const docs: DocumentsState = {
      items: [doc("doc-1", "A"), doc("doc-2", "B")],
      activeId: "doc-1",
    };
    const r = await resolveDocumentSearch(
      { query: "anything", document_id: "doc-2" },
      userId,
      sessionId,
      docs,
    );
    const parsed = JSON.parse(r.content as string) as {
      engine: string;
      hits: Array<{ documentId: string }>;
    };
    expect(parsed.engine).toBe("vector");
    expect(parsed.hits[0]!.documentId).toBe("doc-2");
  });
});
