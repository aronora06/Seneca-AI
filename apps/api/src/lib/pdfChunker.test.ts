import { describe, it, expect } from "vitest";

import type { DocumentPageText } from "@seneca/shared";

import { chunkPages, _internals } from "./pdfChunker.js";

const { TARGET_CHARS, OVERLAP_CHARS } = _internals;

function page(num: number, text: string): DocumentPageText {
  return { page: num, text, charCount: text.length };
}

describe("chunkPages", () => {
  it("returns an empty list for an empty input", () => {
    expect(chunkPages([])).toEqual([]);
  });

  it("drops whitespace-only pages", () => {
    expect(chunkPages([page(1, "   \n\n  ")])).toEqual([]);
  });

  it("emits one chunk for a short page", () => {
    const out = chunkPages([page(1, "A few short sentences. Nothing fancy.")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.page).toBe(1);
    expect(out[0]!.text).toBe("A few short sentences. Nothing fancy.");
    expect(out[0]!.chunkIndex).toBe(0);
  });

  it("preserves the page number on every chunk", () => {
    const text = "x ".repeat(TARGET_CHARS); // forces multiple chunks
    const out = chunkPages([page(3, text)]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.page === 3)).toBe(true);
  });

  it("chunk_index is dense and monotonically increasing across pages", () => {
    const out = chunkPages([
      page(1, "alpha. beta. gamma."),
      page(2, "delta. epsilon. zeta."),
      page(3, "eta. theta. iota."),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("chunks overlap by approximately OVERLAP_CHARS", () => {
    // Build a chunkable run of unique sentences so we can detect overlap.
    const sentence = "The quick brown fox jumps over the lazy dog. ";
    const text = sentence.repeat(80); // ~3600 chars; will produce multiple chunks
    const out = chunkPages([page(1, text)]);
    expect(out.length).toBeGreaterThan(1);

    // Each chunk after the first must share trailing text with the
    // previous chunk's head (well within OVERLAP_CHARS).
    for (let i = 1; i < out.length; i++) {
      const prevTail = out[i - 1]!.text.slice(-OVERLAP_CHARS);
      const head = out[i]!.text.slice(0, OVERLAP_CHARS);
      // There must be SOME shared word substring of >=5 chars.
      const sharedWord = head
        .split(" ")
        .find((w) => w.length >= 5 && prevTail.includes(w));
      expect(sharedWord, `chunk ${i} lacks overlap with chunk ${i - 1}`).toBeDefined();
    }
  });

  it("each chunk stays within ~TARGET_CHARS (allowing for soft boundaries)", () => {
    const sentence = "Lorem ipsum dolor sit amet. ";
    const text = sentence.repeat(200);
    const out = chunkPages([page(1, text)]);
    // Allow a small slack because we break on soft boundaries that may
    // sit slightly past the ideal end.
    for (const c of out) {
      expect(c.text.length).toBeLessThanOrEqual(TARGET_CHARS + 200);
    }
  });

  it("respects sentence boundaries when chunking", () => {
    const text = ("Paragraph one. ".repeat(150) + "\n\nParagraph two. ".repeat(150)).trim();
    const out = chunkPages([page(1, text)]);
    expect(out.length).toBeGreaterThan(1);
    // Each chunk should end with a sensible punctuator or be the last one.
    for (let i = 0; i < out.length - 1; i++) {
      const tail = out[i]!.text.trimEnd();
      const lastChar = tail.slice(-1);
      expect([".", "!", "?", ",", ";"], `chunk ${i} ends mid-sentence`).toContain(
        lastChar,
      );
    }
  });

  it("collapses whitespace in chunk text", () => {
    const out = chunkPages([page(1, "a   b   \n\n  c\t\td")]);
    expect(out[0]!.text).toBe("a b c d");
  });
});

describe("findSoftBoundary", () => {
  it("prefers the latest paragraph break in range", () => {
    const text = "a b c.\n\nd e f. g h i.";
    const ideal = text.length;
    const end = _internals.findSoftBoundary(text, 0, ideal);
    expect(end).toBeGreaterThanOrEqual(text.indexOf(". ") + 2);
  });

  it("falls back to the ideal end when no boundary is in range", () => {
    // No punctuation at all → no soft boundary reachable.
    const text = "abcdefghijklmnopqrstuvwxyz";
    expect(_internals.findSoftBoundary(text, 0, 10)).toBe(10);
  });
});
