/**
 * Tests for the PPTX extractor.
 *
 * We don't ship a sample binary in the repo, so we synthesise a minimal
 * .pptx in-memory with JSZip — that's the same exact loader the
 * extractor uses, so this exercises the real code path.
 */

import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { pptxExtractor, _internals } from "./pptx.js";

async function buildFakePptx(
  slides: { paragraphs: string[][] }[],
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<types/>");
  slides.forEach((slide, i) => {
    const paragraphs = slide.paragraphs
      .map(
        (runs) =>
          `<a:p>${runs.map((r) => `<a:r><a:t>${r}</a:t></a:r>`).join("")}</a:p>`,
      )
      .join("");
    const xml = `<?xml version="1.0"?><p:sld xmlns:a="x" xmlns:p="y"><p:cSld><p:spTree>${paragraphs}</p:spTree></p:cSld></p:sld>`;
    zip.file(`ppt/slides/slide${i + 1}.xml`, xml);
  });
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}

describe("pptxExtractor", () => {
  it("emits one page per slide", async () => {
    const buf = await buildFakePptx([
      { paragraphs: [["Title"], ["Sub", "title"]] },
      { paragraphs: [["Body of slide two"]] },
      { paragraphs: [["Final slide"]] },
    ]);
    const result = await pptxExtractor.extract(buf);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]!.text).toContain("Title");
    expect(result.pages[0]!.text).toContain("Subtitle");
    expect(result.pages[1]!.text).toContain("Body of slide two");
    expect(result.pages[2]!.text).toContain("Final slide");
  });

  it("orders slides numerically (slide10 after slide2)", () => {
    // We don't need to round-trip a 10-slide zip just for this — the
    // helper is unit-tested directly.
    expect(_internals.slideIndex("ppt/slides/slide2.xml")).toBe(2);
    expect(_internals.slideIndex("ppt/slides/slide10.xml")).toBe(10);
  });

  it("decodes XML entities in slide text", () => {
    expect(_internals.decodeXmlEntities("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
  });

  it("returns a single empty page when the deck has no slides", async () => {
    const buf = await buildFakePptx([]);
    const result = await pptxExtractor.extract(buf);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.text).toBe("");
  });

  it("sniffs a zip with a ppt/ marker as a pptx", async () => {
    const buf = await buildFakePptx([{ paragraphs: [["x"]] }]);
    expect(pptxExtractor.sniff(buf)).toBe(true);
  });
});
