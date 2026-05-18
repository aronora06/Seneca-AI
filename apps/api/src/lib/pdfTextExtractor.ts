/**
 * Server-side PDF text extraction.
 *
 * Wraps `pdfjs-dist`'s legacy Node build to pull per-page text out of a
 * Buffer. The output feeds two consumers:
 *
 *   1. The `document_read_page` tool, so Seneca can read PDF content
 *      cheaply (plain text → small input cost) instead of asking the user
 *      to enable vision capture (whole rendered page → ~$0.02–0.05 per
 *      page in Opus tokens).
 *   2. Future RAG / search work (Priority 1b in the handoff) which needs
 *      per-page granularity for chunking + embeddings.
 *
 * Scanned PDFs (where pages are images, not text) return near-empty
 * strings — a separate "looks scanned" check informs the caller to fall
 * back to the page-renderer pipeline.
 */

import { createRequire } from "node:module";

/**
 * pdfjs-dist v5 ships its legacy entry as `legacy/build/pdf.mjs`. Static
 * `import` from a `.mjs` path that has no package `exports` map trips
 * tsc / Node ESM resolution in some configs, so we lazily require() it
 * via createRequire — pdfjs's legacy build is plain CommonJS-compatible
 * ESM and loads happily this way.
 */
const requireFromHere = createRequire(import.meta.url);

// Typed loosely — pdfjs-dist's TypeScript types are gigantic and live
// under `types/src/`; we only touch a handful of methods, so a hand-rolled
// minimal interface is friendlier than dragging the full surface in.
interface PdfJsLib {
  getDocument(params: {
    data: Uint8Array;
    verbosity?: number;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
    disableFontFace?: boolean;
  }): { promise: Promise<PdfDocument> };
  VerbosityLevel: { ERRORS: number; WARNINGS: number; INFOS: number };
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

interface PdfPage {
  getTextContent(): Promise<{ items: Array<PdfTextItem | PdfMarkedContent> }>;
  cleanup(): void;
}

interface PdfTextItem {
  /** Discriminator: TextItem has `str`, marked-content blocks don't. */
  str: string;
  /** True when this item is at the end of a "line" in the PDF's content stream. */
  hasEOL?: boolean;
}

// Marked content blocks don't have `str` — we skip them.
interface PdfMarkedContent {
  type: string;
}

function isTextItem(
  item: PdfTextItem | PdfMarkedContent,
): item is PdfTextItem {
  return typeof (item as { str?: unknown }).str === "string";
}

/**
 * Below this average chars-per-page the document is treated as scanned
 * and the `document_read_page` resolver falls back to rendering the page
 * as a PNG. Tuned against a few hand-tested PDFs: born-digital papers
 * yield ~1500–3000 chars/page, while scanned PDFs typically return 0–20
 * (artefacts of any tiny embedded text layer like page numbers).
 */
export const SCANNED_AVG_CHARS_THRESHOLD = 30;
/** Per-page char count below which a single page is treated as image-only. */
export const SCANNED_PAGE_CHARS_THRESHOLD = 20;

export interface DocumentPageText {
  page: number;
  text: string;
  charCount: number;
}

export interface ExtractionResult {
  pages: DocumentPageText[];
  totalChars: number;
  /** True when the document averaged fewer than SCANNED_AVG_CHARS_THRESHOLD chars per page. */
  looksScanned: boolean;
}

let cachedLib: PdfJsLib | null = null;

async function getPdfJs(): Promise<PdfJsLib> {
  if (cachedLib) return cachedLib;
  // pdfjs-dist v5 publishes the legacy entry as an ESM module; require()
  // returns the namespace object directly. We also disable the default
  // worker — the legacy build uses an inline fake worker under the hood,
  // which is exactly what we want server-side.
  const mod = requireFromHere(
    "pdfjs-dist/legacy/build/pdf.mjs",
  ) as PdfJsLib;
  cachedLib = mod;
  return mod;
}

/**
 * Extract per-page text from a PDF buffer.
 *
 * Throws on parse failure (corrupt file, encryption we can't bypass, etc).
 * The route handler is responsible for catching and surfacing an error
 * the user can act on — typically "rolled back the upload, please try a
 * different file".
 */
export async function extractTextFromPdf(
  bytes: Buffer,
): Promise<ExtractionResult> {
  const pdfjs = await getPdfJs();

  const loadingTask = pdfjs.getDocument({
    // CRITICAL: pdfjs detaches the underlying ArrayBuffer of whatever
    // typed array it gets, even on the legacy build that runs inline
    // (no real worker). If we passed a view into the caller's Buffer,
    // pdfjs would empty it in place — that's what bit us in 1a's first
    // pass: the memory documentStore was holding the same Buffer by
    // reference, so after extraction the stored bytes were zero-length
    // and the client could no longer re-fetch / re-render the PDF.
    //
    // `new Uint8Array(bytes)` copies the contents into a fresh
    // independent ArrayBuffer that pdfjs is welcome to detach.
    data: new Uint8Array(bytes),
    verbosity: pdfjs.VerbosityLevel.ERRORS, // suppress noisy infos / warnings
    isEvalSupported: false, // hardening: PDFs shouldn't run JS evaluators here
    useSystemFonts: false, // we don't render here; no fonts needed
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;

  try {
    const pages: DocumentPageText[] = [];
    let totalChars = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      let text: string;
      try {
        const content = await page.getTextContent();
        text = joinTextItems(content.items);
      } finally {
        // Free pdfjs's per-page caches as we go. A 400-page PDF without
        // this can balloon to several hundred MB resident.
        page.cleanup();
      }
      pages.push({ page: pageNumber, text, charCount: text.length });
      totalChars += text.length;
    }

    const avg = pdf.numPages > 0 ? totalChars / pdf.numPages : 0;
    return {
      pages,
      totalChars,
      looksScanned: avg < SCANNED_AVG_CHARS_THRESHOLD,
    };
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}

/**
 * Collapse a page's text items into a flat string. We join words with
 * single spaces and emit a newline whenever pdfjs flagged an item as
 * end-of-line. Multiple whitespace runs are collapsed at the very end so
 * the output is friendly to LLM context.
 */
function joinTextItems(
  items: Array<PdfTextItem | PdfMarkedContent>,
): string {
  const parts: string[] = [];
  for (const item of items) {
    if (!isTextItem(item)) continue;
    parts.push(item.str);
    if (item.hasEOL) parts.push("\n");
    else parts.push(" ");
  }
  return parts.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
