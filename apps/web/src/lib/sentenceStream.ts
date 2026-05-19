/**
 * Streaming sentence chunker for TTS.
 *
 * Why this exists:
 *   The agent loop emits Anthropic text deltas as they arrive, and
 *   may execute zero or more tool calls between bursts of text. If we
 *   wait for the full turn to finish before speaking, the user sees
 *   the answer on screen but hears nothing until every tool returns —
 *   a long, awkward gap that breaks the conversational illusion.
 *
 *   Instead, we buffer deltas until we have a complete sentence (or a
 *   paragraph break, or the buffer grows past a hard cap), then flush
 *   that sentence to TTS. The audio queue starts playing the first
 *   sentence while the rest of the response — and any interleaved
 *   tool calls — are still in flight. This is the "tandem activity"
 *   feel: Seneca starts talking immediately, and the canvas updates
 *   while he speaks.
 *
 * Boundary rules:
 *   - Hard boundary on `.`, `!`, `?` (one or more) optionally followed
 *     by closing quote / bracket characters, then whitespace.
 *   - Hard boundary on a blank line (paragraph break).
 *   - Soft cap: if the buffer grows past MAX_CHUNK_CHARS without any
 *     boundary (rare — happens with code blocks, very long lists), we
 *     flush whatever we have at the next whitespace to keep latency
 *     bounded.
 *   - We do NOT try to suppress flushing on common abbreviations
 *     ("Dr.", "U.S.", "3.14"). A speech synthesiser pronounces
 *     "Dr. Smith" naturally even if we split between them; the cost
 *     of misdetecting is a micropause, not garbled audio. The cost of
 *     over-buffering — silence while text is on screen — is worse.
 */

// A sentence boundary fires only when we see actual whitespace AFTER
// the terminator. Anchoring on end-of-string would force-flush a
// partial sentence that's just waiting for the next delta to land.
const SENTENCE_END = /([.!?]+(?:["')\]]+)?\s+|\n{2,})/g;

const DEFAULT_MAX_CHUNK_CHARS = 320;

export interface ChunkResult {
  /** Sentence-ish chunks ready to send to TTS, in order. */
  chunks: string[];
  /** Whatever didn't reach a boundary yet. Pass back in next call. */
  remainder: string;
}

/**
 * Extracts complete sentence chunks from a running buffer.
 *
 * Typical usage:
 *
 *   let buf = "";
 *   for await (const delta of stream) {
 *     buf += delta;
 *     const { chunks, remainder } = extractChunks(buf);
 *     buf = remainder;
 *     for (const c of chunks) tts.speak(c);
 *   }
 *   // On stream end, flush whatever's left:
 *   const tail = buf.trim();
 *   if (tail) tts.speak(tail);
 */
export function extractChunks(
  buffer: string,
  options: { maxChunkChars?: number } = {},
): ChunkResult {
  const maxChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const chunks: string[] = [];
  let cursor = 0;

  SENTENCE_END.lastIndex = 0;
  while (true) {
    SENTENCE_END.lastIndex = cursor;
    const m = SENTENCE_END.exec(buffer);
    if (!m) break;
    const end = m.index + m[0].length;
    const chunk = buffer.slice(cursor, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    cursor = end;
  }

  let remainder = buffer.slice(cursor);

  // Soft cap: if the tail without a boundary is huge, find the last
  // whitespace and flush up to there so we don't accumulate forever.
  while (remainder.length > maxChars) {
    const ws = remainder.lastIndexOf(" ", maxChars);
    if (ws <= 0) break;
    const forced = remainder.slice(0, ws).trim();
    if (forced.length === 0) break;
    chunks.push(forced);
    remainder = remainder.slice(ws + 1);
  }

  return { chunks, remainder };
}

/**
 * Stateful helper: tracks the buffer for you. Useful inside an event
 * loop that handles deltas one at a time.
 */
export interface StreamingChunker {
  /** Append a text delta. Returns any chunks newly ready to speak. */
  push(delta: string): string[];
  /** Flush whatever's left without a terminating boundary. */
  flush(): string[];
  /** Discard the buffer without flushing — used on user interrupt. */
  reset(): void;
}

export function createStreamingChunker(options: {
  maxChunkChars?: number;
} = {}): StreamingChunker {
  let buf = "";
  return {
    push(delta: string): string[] {
      buf += delta;
      const { chunks, remainder } = extractChunks(buf, options);
      buf = remainder;
      return chunks;
    },
    flush(): string[] {
      const tail = buf.trim();
      buf = "";
      return tail.length > 0 ? [tail] : [];
    },
    reset(): void {
      buf = "";
    },
  };
}
