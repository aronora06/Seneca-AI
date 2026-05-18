/**
 * .docx extractor (Phase 5 / Priority 1c).
 *
 * Uses `mammoth` to convert Word XML into a markdown string and then
 * runs it through the same page-splitter as the markdown extractor —
 * so a 50-page Word doc gets the same heading-driven pagination as a
 * 50-section markdown file. The persisted `renderHint: "markdown"`
 * tells the DocumentTab to render the result with the markdown
 * pipeline, not Word's native paginated layout (which we don't
 * reconstruct).
 */

import { _internals as markdownInternals } from "./markdown.js";
import type { DocumentExtractor, ExtractionResult } from "./types.js";

// Mammoth uses cjs internals; importing the default and reading
// `.default` defensively so the legacy / esm interop works in tsx.
import mammothImport from "mammoth";

interface MammothApi {
  convertToMarkdown(input: { buffer: Buffer }): Promise<{ value: string }>;
}

function getMammoth(): MammothApi {
  const m = (mammothImport as unknown as { default?: MammothApi }).default;
  return m ?? (mammothImport as unknown as MammothApi);
}

const DOCX_MIMES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Some browsers/clients send the generic zip type; the sniff
  // function disambiguates from a regular .zip.
  "application/zip",
];

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"

export const docxExtractor: DocumentExtractor = {
  id: "docx",
  mimes: DOCX_MIMES,
  extensions: [".docx"],
  sniff,
  extract,
  renderHint: "markdown",
};

function sniff(bytes: Buffer): boolean {
  if (bytes.length < ZIP_MAGIC.length) return false;
  if (!bytes.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) return false;
  // The OOXML container always has a top-level entry named
  // `[Content_Types].xml`; we look for "word/" later in the file as a
  // cheap proxy. A pptx (slides) starts with the same zip magic, so
  // the substring check disambiguates the two without unzipping.
  const head = bytes.subarray(0, Math.min(bytes.length, 4_096)).toString(
    "latin1",
  );
  return /word\//i.test(head);
}

async function extract(bytes: Buffer): Promise<ExtractionResult> {
  const mammoth = getMammoth();
  const result = await mammoth.convertToMarkdown({ buffer: bytes });
  const md = result.value ?? "";
  return {
    pages: markdownInternals.pageify(md),
  };
}

export const _internals = {
  sniff,
  ZIP_MAGIC,
};
