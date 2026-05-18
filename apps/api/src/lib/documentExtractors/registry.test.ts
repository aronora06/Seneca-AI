/**
 * Tests for the Phase 5 document extractor registry.
 *
 * Covers:
 *   - the registry exposes every concrete extractor
 *   - selection by MIME, extension, and sniff (in that order)
 *   - sniff specificity: zip-magic without word/ payload picks pptx
 *     (and vice versa), neither picks docx blindly
 *   - text vs binary discrimination for the markdown / plain-text path
 *   - unsupported uploads return null so the route can 415
 */

import { describe, expect, it } from "vitest";

import {
  allSupportedMimes,
  listExtractors,
  selectExtractor,
} from "./index.js";

function utf8(s: string): Buffer {
  return Buffer.from(s, "utf8");
}

function buildFakeZip({ marker }: { marker: string }): Buffer {
  // Minimum PK\x03\x04 header + a substring the sniff functions scan for.
  // Not a valid zip — but the sniff only looks at the magic + payload
  // marker via `latin1` decoding, so this is enough.
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(new Array(32).fill(0)),
    Buffer.from(marker, "latin1"),
    Buffer.from(new Array(64).fill(0)),
  ]);
}

describe("documentExtractor registry", () => {
  it("exposes a registry that includes every format", () => {
    const ids = listExtractors().map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining(["pdf", "docx", "pptx", "html", "markdown"]),
    );
  });

  it("aggregates every supported MIME without duplicates", () => {
    const mimes = allSupportedMimes();
    expect(new Set(mimes).size).toBe(mimes.length);
    expect(mimes).toContain("application/pdf");
    expect(mimes).toContain("text/markdown");
    expect(mimes).toContain("text/html");
  });

  it("picks the PDF extractor by mime", () => {
    const ex = selectExtractor({
      mime: "application/pdf",
      filename: "paper.pdf",
      bytes: utf8("%PDF-1.7\n..."),
    });
    expect(ex?.id).toBe("pdf");
    expect(ex?.renderHint).toBe("pdfjs");
  });

  it("picks the markdown extractor by .md extension when the mime is generic", () => {
    const ex = selectExtractor({
      mime: "application/octet-stream",
      filename: "notes.md",
      bytes: utf8("# title\n\nhi"),
    });
    expect(ex?.id).toBe("markdown");
    expect(ex?.renderHint).toBe("markdown");
  });

  it("picks markdown for plain UTF-8 text with no extension and no mime", () => {
    const ex = selectExtractor({
      mime: null,
      filename: null,
      bytes: utf8("Just some prose without any markdown."),
    });
    expect(ex?.id).toBe("markdown");
  });

  it("disambiguates docx vs pptx by the zip payload marker", () => {
    const docxBytes = buildFakeZip({ marker: "word/document.xml" });
    const pptxBytes = buildFakeZip({ marker: "ppt/slides/slide1.xml" });
    expect(
      selectExtractor({
        mime: "application/zip",
        filename: "report.docx",
        bytes: docxBytes,
      })?.id,
    ).toBe("docx");
    expect(
      selectExtractor({
        mime: "application/zip",
        filename: "deck.pptx",
        bytes: pptxBytes,
      })?.id,
    ).toBe("pptx");
  });

  it("falls back to extension when sniff is ambiguous (raw zip with no marker)", () => {
    const ex = selectExtractor({
      mime: "application/zip",
      filename: "memo.docx",
      bytes: buildFakeZip({ marker: "no-marker-here" }),
    });
    // No payload marker -> mime falls through, but the .docx extension
    // is enough to claim it.
    expect(ex?.id).toBe("docx");
  });

  it("picks html for documents that start with <!doctype html", () => {
    const ex = selectExtractor({
      mime: "text/html",
      filename: "page.html",
      bytes: utf8("<!DOCTYPE html><html><body>hi</body></html>"),
    });
    expect(ex?.id).toBe("html");
    expect(ex?.renderHint).toBe("html");
  });

  it("returns null for an unsupported binary blob", () => {
    // Random non-text, non-zip, non-PDF bytes.
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    expect(
      selectExtractor({
        mime: "application/octet-stream",
        filename: "noise.bin",
        bytes,
      }),
    ).toBeNull();
  });
});
