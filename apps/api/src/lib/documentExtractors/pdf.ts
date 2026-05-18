/**
 * PDF extractor (Phase 5 wrapper around the existing pdfTextExtractor).
 *
 * Behavior is intentionally identical to the pre-Phase-5 path so that
 * historical PDFs don't subtly re-extract differently; this file is
 * just the adapter that fits the `DocumentExtractor` interface.
 */

import { looksLikePdf } from "../documentStorage.js";
import { extractTextFromPdf } from "../pdfTextExtractor.js";
import type { DocumentExtractor } from "./types.js";

export const pdfExtractor: DocumentExtractor = {
  id: "pdf",
  mimes: ["application/pdf"],
  extensions: [".pdf"],
  sniff: looksLikePdf,
  extract: async (bytes) => {
    const result = await extractTextFromPdf(bytes);
    return {
      pages: result.pages,
      looksScanned: result.looksScanned,
    };
  },
  renderHint: "pdfjs",
};
