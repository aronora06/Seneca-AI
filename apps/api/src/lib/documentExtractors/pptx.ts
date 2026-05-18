/**
 * .pptx extractor (Phase 5 / Priority 1c).
 *
 * No good "pptx → markdown" lib exists that's worth a heavy dep, so we
 * unzip the OOXML container ourselves with JSZip, find each
 * `ppt/slides/slideN.xml`, and pull text out of `<a:t>` runs. One slide
 * → one "page" of extracted text, so `document_search` snippets and
 * page navigation feel natural for presentations.
 *
 * The DocumentTab renders the result as markdown — we don't try to
 * recreate PowerPoint's visual layout. The point is that Seneca can
 * read and search slide text, not pixel-perfect playback.
 */

import JSZip from "jszip";

import type { DocumentPageText } from "@seneca/shared";

import type { DocumentExtractor, ExtractionResult } from "./types.js";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const PPTX_MIMES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Same zip-collision caveat as docx.ts — the sniff disambiguates.
  "application/zip",
];

export const pptxExtractor: DocumentExtractor = {
  id: "pptx",
  mimes: PPTX_MIMES,
  extensions: [".pptx"],
  sniff,
  extract,
  renderHint: "markdown",
};

function sniff(bytes: Buffer): boolean {
  if (bytes.length < ZIP_MAGIC.length) return false;
  if (!bytes.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) return false;
  const head = bytes.subarray(0, Math.min(bytes.length, 4_096)).toString(
    "latin1",
  );
  return /ppt\/slides\//i.test(head);
}

async function extract(bytes: Buffer): Promise<ExtractionResult> {
  const zip = await JSZip.loadAsync(bytes);
  // Slide files are `ppt/slides/slide1.xml`, `slide2.xml`, ...
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => slideIndex(a) - slideIndex(b));

  if (slideEntries.length === 0) {
    return { pages: [{ page: 1, text: "", charCount: 0 }] };
  }

  const pages: DocumentPageText[] = [];
  for (let i = 0; i < slideEntries.length; i++) {
    const name = slideEntries[i]!;
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const slideText = extractRunsFromSlideXml(xml);
    pages.push({
      page: i + 1,
      text: slideText,
      charCount: slideText.length,
    });
  }

  return { pages };
}

function slideIndex(name: string): number {
  const match = name.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

/**
 * Pull every `<a:t>...</a:t>` text run out of a slide's XML and join
 * them with spaces / linebreaks. The OOXML schema also has
 * `<a:p>` paragraph wrappers — we treat paragraph boundaries as
 * newlines so snippet text reads like real prose.
 */
function extractRunsFromSlideXml(xml: string): string {
  const paragraphs: string[] = [];
  const paragraphRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  const runRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
  for (
    let pMatch = paragraphRe.exec(xml);
    pMatch !== null;
    pMatch = paragraphRe.exec(xml)
  ) {
    const inner = pMatch[1] ?? "";
    const runs: string[] = [];
    for (
      let rMatch = runRe.exec(inner);
      rMatch !== null;
      rMatch = runRe.exec(inner)
    ) {
      runs.push(decodeXmlEntities(rMatch[1] ?? ""));
    }
    runRe.lastIndex = 0;
    const line = runs.join("").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join("\n").trim();
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export const _internals = {
  sniff,
  extractRunsFromSlideXml,
  decodeXmlEntities,
  slideIndex,
};
