/**
 * Document extractor registry (Phase 5 / Priority 1c).
 *
 * Selection order:
 *   1. Explicit MIME type from the upload's `Content-Type` header
 *      (most reliable when the client sets it correctly).
 *   2. Filename extension from the `X-File-Name` header (covers
 *      browsers / curl that default to `application/octet-stream`).
 *   3. Magic-byte sniff (last resort — disambiguates zip-based
 *      docx vs pptx, falsifies fake `.pdf` files).
 *
 * The registry order below matters for sniff fall-through: pdf first
 * (since `%PDF-` is unambiguous), then the OOXML formats (docx then
 * pptx — order doesn't matter since each sniff looks for its own
 * payload marker), then html, then the catch-all markdown / plain
 * text extractor.
 */

import { docxExtractor } from "./docx.js";
import { htmlExtractor } from "./html.js";
import { markdownExtractor } from "./markdown.js";
import { pdfExtractor } from "./pdf.js";
import { pptxExtractor } from "./pptx.js";
import type { DocumentExtractor } from "./types.js";

export type { DocumentExtractor, ExtractionResult } from "./types.js";

const REGISTRY: readonly DocumentExtractor[] = [
  pdfExtractor,
  docxExtractor,
  pptxExtractor,
  htmlExtractor,
  markdownExtractor,
];

export function listExtractors(): readonly DocumentExtractor[] {
  return REGISTRY;
}

/**
 * Pick an extractor for the upload. Returns null when none match.
 * Caller is expected to return a 415 in that case.
 */
export function selectExtractor(opts: {
  mime?: string | null;
  filename?: string | null;
  bytes: Buffer;
}): DocumentExtractor | null {
  const mime = (opts.mime ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  const ext = filenameExtension(opts.filename);

  // Pass 1: exact mime hit. The first registered extractor whose mime
  // list contains the upload's content-type also has to pass its sniff
  // — that defends against a `Content-Type: application/zip` upload
  // that's neither a docx NOR a pptx (e.g. a plain archive).
  if (mime) {
    for (const ex of REGISTRY) {
      if (ex.mimes.includes(mime) && ex.sniff(opts.bytes)) return ex;
    }
    // Fallback: trust the mime even if sniff didn't match (e.g. a
    // tiny .pdf without enough bytes to sniff). Only kicks in if the
    // first-pass loop didn't find anything.
    for (const ex of REGISTRY) {
      if (ex.mimes.includes(mime)) return ex;
    }
  }

  // Pass 2: extension. Same sniff-first / mime-fallback dance.
  if (ext) {
    for (const ex of REGISTRY) {
      if (ex.extensions.includes(ext) && ex.sniff(opts.bytes)) return ex;
    }
    for (const ex of REGISTRY) {
      if (ex.extensions.includes(ext)) return ex;
    }
  }

  // Pass 3: pure sniff. Walks the registry in declaration order so the
  // most specific signature (pdf) wins over a more permissive one
  // (markdown / plain text, which accepts almost anything).
  for (const ex of REGISTRY) {
    if (ex.sniff(opts.bytes)) return ex;
  }

  return null;
}

function filenameExtension(filename: string | null | undefined): string | null {
  if (!filename) return null;
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return filename.slice(dot).toLowerCase();
}

/**
 * Aggregated MIME list across every registered extractor. The upload
 * route uses this to widen `express.raw({ type: ... })` so we accept
 * every supported binary type with a single middleware.
 */
export function allSupportedMimes(): readonly string[] {
  const set = new Set<string>();
  for (const ex of REGISTRY) for (const m of ex.mimes) set.add(m);
  return Array.from(set);
}

export const _internals = {
  filenameExtension,
};
