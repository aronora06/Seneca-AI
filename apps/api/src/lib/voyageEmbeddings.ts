/**
 * Thin client around Voyage AI's embeddings endpoint.
 *
 * Voyage is Anthropic's recommended embeddings partner (Claude doesn't
 * ship its own embeddings model). We hit `/v1/embeddings` directly — the
 * official Voyage SDK exists but adds a heavy transitive dependency tree
 * for one endpoint, so we stay lean.
 *
 * The client surfaces two failure modes the upstream caller cares about:
 *   - `VoyageNotConfiguredError` when `VOYAGE_API_KEY` is unset. The
 *     upload pipeline catches this and stamps `indexStatus: "skipped"`
 *     so the sidebar can show an honest pill.
 *   - `VoyageRequestError` for any HTTP / network failure (4xx / 5xx /
 *     timeout). The upload pipeline catches this too and stamps
 *     `indexStatus: "failed"`; `document_search` falls back to substring
 *     until the next index attempt succeeds.
 *
 * No retries here — the caller (upload or on-demand reindex) decides
 * whether to retry based on whether the user is waiting on the result.
 */

import { env } from "../env.js";

/**
 * Voyage's request body mode. "document" runs the indexing-side prep,
 * "query" runs the query-side prep — same model, slightly different
 * preprocessing under the hood. Using the right one improves recall.
 */
export type VoyageEmbedMode = "document" | "query";

export class VoyageNotConfiguredError extends Error {
  constructor() {
    super(
      "VOYAGE_API_KEY is not set. Document search will degrade to substring fallback.",
    );
    this.name = "VoyageNotConfiguredError";
  }
}

export class VoyageRequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "VoyageRequestError";
    this.status = status;
  }
}

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

/**
 * Maximum number of texts Voyage accepts per request. The API itself
 * accepts up to 128 inputs per call; we cap a bit lower to avoid edge
 * cases on the very long inputs we send (full ~500-token chunks).
 */
const BATCH_LIMIT = 96;

/**
 * Request timeout (ms). Voyage routinely embeds 100 chunks in <2s, so
 * 30s is generous — long enough for a back-pressured day, short enough
 * that a stuck request doesn't pin the upload pipeline open.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Embed the given texts. Returns embeddings in the same order as the
 * input array, even if we had to split the call into multiple batches.
 *
 * Empty / whitespace-only inputs are passed through as 1024-dim zero
 * vectors — Voyage's API rejects empty strings, but the caller would
 * otherwise need to filter + re-map indices, which is error-prone.
 * Zero vectors won't match anything semantically.
 */
export async function embed(
  texts: string[],
  mode: VoyageEmbedMode,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!env.voyageApiKey) throw new VoyageNotConfiguredError();

  const out: number[][] = new Array(texts.length);
  const realIndices: number[] = [];
  const realTexts: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]!;
    if (!t || !t.trim()) {
      out[i] = zeroVector();
      continue;
    }
    realIndices.push(i);
    realTexts.push(t);
  }

  for (let start = 0; start < realTexts.length; start += BATCH_LIMIT) {
    const batchTexts = realTexts.slice(start, start + BATCH_LIMIT);
    const batchIndices = realIndices.slice(start, start + BATCH_LIMIT);

    const batchEmbeddings = await embedBatch(batchTexts, mode);
    if (batchEmbeddings.length !== batchTexts.length) {
      throw new VoyageRequestError(
        `Voyage returned ${batchEmbeddings.length} vectors for ${batchTexts.length} inputs`,
      );
    }
    for (let j = 0; j < batchEmbeddings.length; j++) {
      out[batchIndices[j]!] = batchEmbeddings[j]!;
    }
  }

  return out;
}

async function embedBatch(
  texts: string[],
  mode: VoyageEmbedMode,
): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.voyageApiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: env.voyageModel,
        input_type: mode,
      }),
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new VoyageRequestError("Voyage embeddings request timed out", null);
    }
    throw new VoyageRequestError(
      err instanceof Error ? err.message : String(err),
      null,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await safeBody(res);
    throw new VoyageRequestError(
      `Voyage embeddings ${res.status}: ${body.slice(0, 240)}`,
      res.status,
    );
  }

  const json = (await res.json()) as VoyageEmbeddingResponse;
  if (!json.data || !Array.isArray(json.data)) {
    throw new VoyageRequestError("Voyage response missing data array");
  }
  // Voyage returns data sorted by index in our experience, but the API
  // doesn't promise that. Sort defensively before unpacking.
  json.data.sort((a, b) => a.index - b.index);
  return json.data.map((d) => d.embedding);
}

async function safeBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Standard 1024-dim zero vector. `voyage-3-large` produces 1024 dims;
 * if we ever switch to a different model with a different dim, this
 * constant and the `vector(1024)` column type in setup.md need to move
 * together.
 */
export const EMBEDDING_DIMS = 1024;

function zeroVector(): number[] {
  return new Array(EMBEDDING_DIMS).fill(0);
}

/**
 * Cosine similarity between two same-dimensional vectors. Returned in
 * `[-1, 1]`; we clamp + normalise to `[0, 1]` for the search-hit `score`
 * field (1 = same direction; 0 = orthogonal; below 0 collapses to 0
 * because we never want a "negative" relevance signal in the UI).
 *
 * Brute-force is fine here — sessions cap out at a few thousand chunks.
 * If we ever ship a session with 100k+ chunks, this routine moves to
 * pgvector's native operators and the memory impl earns an ivfflat-like
 * approximation; not today.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  const raw = dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(raw)) return 0;
  // Map [-1, 1] to [0, 1]; never go negative (the UI doesn't render that).
  const normalised = (raw + 1) / 2;
  if (normalised < 0) return 0;
  if (normalised > 1) return 1;
  return normalised;
}

/**
 * Test surface — these helpers are pure and worth covering without
 * spinning up a fake Voyage server.
 */
export const _internals = {
  cosineSimilarity,
};
