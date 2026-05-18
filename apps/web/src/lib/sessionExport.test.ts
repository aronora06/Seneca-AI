/**
 * Phase D — tests for the markdown export utility. We only test the
 * pure builder + filename helper here; the browser-side download (Blob
 * + URL.createObjectURL + anchor click) is exercised via integration.
 */

import { describe, it, expect } from "vitest";

import type { SessionRecord } from "@seneca/shared";

import { buildSessionMarkdown, sessionFilename } from "./sessionExport";

const BASE: SessionRecord = {
  id: "row-1",
  user_id: "u1",
  name: "Spinoza Letters",
  transcript: [],
  whiteboard: { elements: [] },
  map: { center: [0, 0], zoom: 1, layer: "standard", pins: [], shapes: [] },
  web: { url: null, history: [], historyIndex: -1 },
  documents: { items: [], activeId: null },
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-02T15:30:00.000Z",
};

describe("buildSessionMarkdown", () => {
  it("emits a heading with the session name", () => {
    const md = buildSessionMarkdown(BASE);
    expect(md).toMatch(/^# Spinoza Letters\n/);
  });

  it("includes both turns and skips system notices", () => {
    const md = buildSessionMarkdown({
      ...BASE,
      transcript: [
        {
          id: "1",
          role: "user",
          text: "What is substance?",
          ts: "2024-01-01T10:00:00Z",
        },
        {
          id: "2",
          role: "seneca",
          text: "Substance is that which is in itself.",
          ts: "2024-01-01T10:00:05Z",
        },
        {
          id: "3",
          role: "system",
          text: "vision_failed",
          ts: "2024-01-01T10:00:06Z",
          notice: { kind: "error", message: "Vision request failed" },
        },
      ],
    });
    expect(md).toContain("### You");
    expect(md).toContain("What is substance?");
    expect(md).toContain("### Seneca");
    expect(md).toContain("Substance is that which is in itself.");
    // System notices stay out of the export.
    expect(md).not.toContain("vision_failed");
    expect(md).not.toContain("Vision request failed");
  });

  it("lists attached documents with their current page", () => {
    const md = buildSessionMarkdown({
      ...BASE,
      documents: {
        items: [
          {
            id: "d1",
            name: "Letters",
            filename: "letters.pdf",
            size: 1024,
            pageCount: 200,
            currentPage: 47,
            uploadedAt: "2024-01-01T09:00:00Z",
          },
        ],
        activeId: "d1",
      },
    });
    expect(md).toContain("## Attached documents");
    expect(md).toContain("**Letters**");
    expect(md).toContain("letters.pdf");
    expect(md).toContain("page 47 of 200");
  });

  it("uses an italic placeholder for empty transcripts", () => {
    const md = buildSessionMarkdown(BASE);
    expect(md).toContain("## Transcript");
    expect(md).toContain("_(empty)_");
  });

  it("renders failed tool calls as quoted italic notes", () => {
    const md = buildSessionMarkdown({
      ...BASE,
      transcript: [
        {
          id: "1",
          role: "seneca",
          text: "Let me check.",
          ts: "2024-01-01T10:00:00Z",
          tools: [
            { id: "t1", name: "web_search", input: {}, ok: false },
            { id: "t2", name: "document_read_page", input: {}, ok: true },
          ],
        },
      ],
    });
    expect(md).toMatch(/tool: `web_search` \(failed\)/);
    expect(md).toMatch(/tool: `document_read_page` \(ok\)/);
  });
});

describe("sessionFilename", () => {
  it("kebab-cases the session name + appends the updated date", () => {
    const filename = sessionFilename(BASE);
    expect(filename).toBe("spinoza-letters-2024-01-02.md");
  });

  it("strips non-alphanumeric chars from the name", () => {
    const filename = sessionFilename({
      ...BASE,
      name: "What's New?? (Q2)",
    });
    expect(filename).toMatch(/^whats-new-q2-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("falls back to 'session' when the name is purely punctuation", () => {
    const filename = sessionFilename({ ...BASE, name: "***" });
    expect(filename).toMatch(/^session-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
