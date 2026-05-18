/**
 * Phase 5 / Priority 1c: document extractor interface.
 *
 * Every supported format (PDF, .docx, .md, .txt, .pptx, .html)
 * implements this interface and gets registered in `index.ts`. The
 * upload route asks the registry to pick the right extractor by
 * mime / extension / magic-byte sniff, then hands it the bytes and
 * stores the resulting `DocumentPageText[]` in the same column shape
 * regardless of source format.
 *
 * Why per-extractor instead of one big switch? Each format has subtly
 * different "what is a page?" semantics (PDFs have real pages; .md
 * doesn't), and isolating the logic per-format keeps the format-
 * specific weirdness out of the upload route.
 */

import type {
  DocumentPageText,
  DocumentRenderHint,
} from "@seneca/shared";

export interface ExtractionResult {
  /**
   * One row per "page" the renderer will surface. For natively-paged
   * formats (PDF) this is real pages; for free-flowing formats (.md,
   * .docx, .html) the extractor splits on logical boundaries (headings,
   * page breaks, slide boundaries) so search snippets stay meaningful.
   */
  pages: DocumentPageText[];
  /**
   * True when extraction confirmed-or-strongly-suspected the document
   * is image-only (e.g. a scanned PDF). Lets the upload route stamp
   * `textStatus: "scanned"` rather than `"extracted"` and skip
   * downstream indexing.
   */
  looksScanned?: boolean;
}

export interface DocumentExtractor {
  /** Stable id used in logs and tests (e.g. "pdf", "docx", "markdown"). */
  id: string;
  /** MIME types this extractor handles. */
  mimes: readonly string[];
  /** File extensions (lower-case, with dot) this extractor handles. */
  extensions: readonly string[];
  /**
   * Magic-byte sniff for ambiguous uploads (e.g. a `.docx` is really a
   * zip — a generic `application/zip` upload still needs to be claimed
   * by the docx extractor). Returning true means "I can extract this";
   * returning false defers to the next candidate.
   */
  sniff(bytes: Buffer): boolean;
  /** The actual extraction. Throws on unrecoverable parse errors. */
  extract(bytes: Buffer): Promise<ExtractionResult>;
  /**
   * What the DocumentTab should mount to render this format. The
   * upload route copies this onto the persisted `DocumentRecord` so
   * the client doesn't need to know per-extractor details.
   */
  renderHint: DocumentRenderHint;
}
