/**
 * Splits per-page extracted text into ~500-token chunks with ~50-token
 * overlap, preserving the page number on every chunk.
 *
 * Token approximation is `chars / 4` (the standard rule-of-thumb for
 * English; close enough for windowing — the embeddings model is what
 * actually tokenises). For non-English content the chunks will be a
 * little shorter, which is fine — we'd rather be safe under the model's
 * context window than chase exact token counts.
 *
 * Chunks try to break on paragraph / sentence boundaries when possible
 * so that an embedding represents a coherent thought, not a word ripped
 * mid-sentence. We fall back to character-level slicing when no
 * boundary is found within the target window.
 */

import type { DocumentPageText } from "@seneca/shared";

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 50;
const MIN_CHUNK_TOKENS = 20;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;
const MIN_CHUNK_CHARS = MIN_CHUNK_TOKENS * CHARS_PER_TOKEN;

export interface PdfChunk {
  /** 1-indexed page the chunk originated from. */
  page: number;
  /** Position within the doc; useful for stable sorting on re-index. */
  chunkIndex: number;
  /** Joined chunk text, whitespace-collapsed. */
  text: string;
}

/**
 * Build chunks from an array of per-page extracted text. Pages whose
 * text is shorter than `MIN_CHUNK_CHARS` produce a single short chunk
 * each (so even a sparse / cover page is searchable).
 *
 * Empty / whitespace-only pages are dropped — embedding them would
 * waste a Voyage call. Scanned PDFs (where extraction yielded nothing)
 * will produce zero chunks and the caller will skip indexing entirely.
 */
export function chunkPages(pages: DocumentPageText[]): PdfChunk[] {
  const out: PdfChunk[] = [];
  let runningIndex = 0;

  for (const p of pages) {
    const cleaned = collapseWhitespace(p.text);
    if (!cleaned) continue;

    if (cleaned.length <= TARGET_CHARS) {
      out.push({ page: p.page, chunkIndex: runningIndex++, text: cleaned });
      continue;
    }

    let pos = 0;
    while (pos < cleaned.length) {
      const remaining = cleaned.length - pos;
      if (remaining <= MIN_CHUNK_CHARS) {
        // Tail too short to be worth a standalone chunk — merge into the
        // previous chunk if we just emitted one for this page, otherwise
        // emit it as-is (better than dropping content).
        const prev = out[out.length - 1];
        if (prev && prev.page === p.page) {
          prev.text = (prev.text + " " + cleaned.slice(pos)).trim();
        } else {
          out.push({
            page: p.page,
            chunkIndex: runningIndex++,
            text: cleaned.slice(pos).trim(),
          });
        }
        break;
      }

      const idealEnd = Math.min(cleaned.length, pos + TARGET_CHARS);
      const end = findSoftBoundary(cleaned, pos, idealEnd);
      const text = cleaned.slice(pos, end).trim();
      if (text) {
        out.push({ page: p.page, chunkIndex: runningIndex++, text });
      }
      if (end >= cleaned.length) break;
      pos = Math.max(pos + 1, end - OVERLAP_CHARS);
    }
  }

  return out;
}

/**
 * Find the latest sentence- or paragraph-boundary within
 * `[pos, idealEnd)`. Falls back to `idealEnd` when no boundary is in
 * range — chunks then break mid-sentence rather than ballooning past
 * the target token budget.
 */
function findSoftBoundary(
  text: string,
  pos: number,
  idealEnd: number,
): number {
  // Search for the latest paragraph break in the last 25% of the
  // window first; widen to sentence terminators if none found.
  const minBoundary = pos + Math.floor((idealEnd - pos) * 0.75);

  for (const pattern of ["\n\n", ". ", "? ", "! ", "; ", ", "]) {
    const idx = text.lastIndexOf(pattern, idealEnd);
    if (idx >= minBoundary) return idx + pattern.length;
  }
  return idealEnd;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Test surface — chunking is the kind of routine where off-by-ones
 * compound silently, so the helpers earn explicit coverage.
 */
export const _internals = {
  TARGET_CHARS,
  OVERLAP_CHARS,
  MIN_CHUNK_CHARS,
  collapseWhitespace,
  findSoftBoundary,
};
