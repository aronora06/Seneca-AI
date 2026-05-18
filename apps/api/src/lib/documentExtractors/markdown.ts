/**
 * Plain-text and Markdown extractor (Phase 5).
 *
 * `text/plain` and `text/markdown` share an extractor because the
 * server-side experience is identical: read the bytes as UTF-8, split
 * into "page-sized" logical blocks for snippet generation, and stash
 * the raw text verbatim. The front-end DocumentTab then renders the
 * file as markdown — pure `.txt` files just don't have any markdown
 * syntax in them, which is fine.
 *
 * Page boundaries: we split on headings first (so `document_search`
 * snippets land on semantically meaningful boundaries), then on
 * ~4000-character paragraphs to keep any one page modestly sized.
 */

import type { DocumentPageText } from "@seneca/shared";

import type { DocumentExtractor, ExtractionResult } from "./types.js";

/**
 * Target page size, in characters. Picked to keep typical short docs
 * on a single page while still chunking the occasional book-length
 * markdown file. The chunker downstream will further split inside
 * pages — this only controls the read-page UX.
 */
const TARGET_CHARS_PER_PAGE = 4_000;

export const markdownExtractor: DocumentExtractor = {
  id: "markdown",
  mimes: ["text/markdown", "text/plain", "text/x-markdown"],
  extensions: [".md", ".markdown", ".txt"],
  sniff: sniffText,
  extract,
  renderHint: "markdown",
};

async function extract(bytes: Buffer): Promise<ExtractionResult> {
  const text = bytes.toString("utf8");
  const pages = pageify(text);
  return { pages };
}

/**
 * Look at the leading bytes for hard signs that this is binary
 * (NUL bytes, high-bit chars before a UTF-8 BOM, etc.). UTF-8 text
 * passes; arbitrary binaries fail.
 */
function sniffText(bytes: Buffer): boolean {
  if (bytes.length === 0) return false;
  // Strip UTF-8 BOM if present.
  let start = 0;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    start = 3;
  }
  // Sample up to the first 4 KB — that's plenty to detect binary.
  const head = bytes.subarray(start, Math.min(bytes.length, start + 4_096));
  for (const b of head) {
    if (b === 0) return false; // NUL — definitely not text
    // Allow tabs, CR, LF; reject other control chars below 0x20
    if (b < 0x09) return false;
    if (b > 0x0d && b < 0x20) return false;
  }
  return true;
}

/**
 * Split the document into virtual pages on heading boundaries. Falls
 * back to paragraph + length-based splitting when no headings are
 * present, so a giant flat `.txt` still gets paginated for usability.
 */
function pageify(text: string): DocumentPageText[] {
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Empty doc -> one empty page so `document_read_page` still works.
  if (normalised.trim().length === 0) {
    return [{ page: 1, text: "", charCount: 0 }];
  }

  // Heading-driven pagination: every `^#+ ` becomes a new page start.
  const headingSplit = normalised.split(/(?=^#{1,6} )/m);

  // If we got > 1 chunks, try to use them as-is — but coalesce tiny
  // chunks into the prior page so we don't end up with a 50-page index
  // for a doc with 50 headings of 100 chars each.
  let logicalPages: string[];
  if (headingSplit.length > 1) {
    logicalPages = coalesceSmall(headingSplit);
  } else {
    // No headings — split on roughly TARGET_CHARS_PER_PAGE boundaries,
    // preferring blank-line breaks.
    logicalPages = splitByLength(normalised);
  }

  return logicalPages.map((chunk, i) => {
    const t = chunk.trim();
    return {
      page: i + 1,
      text: t,
      charCount: t.length,
    };
  });
}

function coalesceSmall(chunks: string[]): string[] {
  const out: string[] = [];
  for (const c of chunks) {
    if (
      out.length > 0 &&
      out[out.length - 1]!.length + c.length < TARGET_CHARS_PER_PAGE
    ) {
      out[out.length - 1] = out[out.length - 1]! + c;
    } else {
      out.push(c);
    }
  }
  return out;
}

function splitByLength(text: string): string[] {
  if (text.length <= TARGET_CHARS_PER_PAGE) return [text];
  const pages: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= TARGET_CHARS_PER_PAGE) {
      pages.push(text.slice(cursor));
      break;
    }
    // Try to break on a blank-line boundary near the target.
    const window = text.slice(cursor, cursor + TARGET_CHARS_PER_PAGE);
    const blank = window.lastIndexOf("\n\n");
    const cut = blank > TARGET_CHARS_PER_PAGE * 0.5 ? blank + 2 : TARGET_CHARS_PER_PAGE;
    pages.push(text.slice(cursor, cursor + cut));
    cursor += cut;
  }
  return pages;
}

export const _internals = {
  sniffText,
  pageify,
  TARGET_CHARS_PER_PAGE,
};
