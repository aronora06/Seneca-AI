/**
 * .html / .htm extractor (Phase 5 / Priority 1c).
 *
 * Sanitises the uploaded HTML and pulls plain text out of it for
 * indexing / snippet generation; the original (sanitised) markup is
 * rendered in a sandboxed iframe by the DocumentTab so the user sees
 * the document as authored, not a markdown reflow.
 *
 * Sanitisation reuses `extractTextFromHtml` from `webProxy.ts` (which
 * also powers the web tab's "extracted text" path), so a single set
 * of stripping rules covers both surfaces.
 */

import { extractTextFromHtml } from "../webProxy.js";
import { _internals as markdownInternals } from "./markdown.js";
import type { DocumentExtractor, ExtractionResult } from "./types.js";

const HTML_MIMES = [
  "text/html",
  "application/xhtml+xml",
];

export const htmlExtractor: DocumentExtractor = {
  id: "html",
  mimes: HTML_MIMES,
  extensions: [".html", ".htm"],
  sniff,
  extract,
  renderHint: "html",
};

function sniff(bytes: Buffer): boolean {
  if (bytes.length < 5) return false;
  // Sample the head; check for any of <!doctype html, <html, <body, or
  // a leading <? (xhtml-style).
  const head = bytes
    .subarray(0, Math.min(bytes.length, 1_024))
    .toString("utf8")
    .toLowerCase()
    .trimStart();
  if (head.startsWith("<!doctype html")) return true;
  if (head.startsWith("<html")) return true;
  if (head.startsWith("<?xml") && /<html/.test(head)) return true;
  return false;
}

async function extract(bytes: Buffer): Promise<ExtractionResult> {
  const raw = bytes.toString("utf8");
  // Use the same stripper the web tab uses so behaviour is consistent.
  // We don't care about truncation here because we want every searchable
  // word in the index, so we ask for a generous cap.
  const { text } = extractTextFromHtml(raw, 1_000_000);
  return { pages: markdownInternals.pageify(text) };
}

export const _internals = {
  sniff,
};
