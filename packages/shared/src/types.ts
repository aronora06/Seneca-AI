/**
 * Shared types for Seneca's frontend, backend, and persistence layer.
 *
 * Keep this file lean — only put things here that genuinely cross the wire
 * or are stored in the database. Component-internal types stay in their
 * package.
 */

export type Role = "user" | "seneca" | "system";

/** A tool call surfaced to the client over SSE while a Claude turn is streaming. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Outcome the client reports back to the server so Seneca can recover from failures. */
export interface ToolResult {
  toolUseId: string;
  ok: boolean;
  /** Free-form note shown to Seneca when ok === false. */
  error?: string;
  /** Optional structured result to feed back to the model. */
  output?: unknown;
}

/**
 * What the UI persists per tool call on a Seneca turn. Includes the
 * outcome so the chat can colour the chip green/red.
 */
export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** True when the client successfully dispatched the tool. */
  ok?: boolean;
  /** Set when ok === false; human-readable. */
  error?: string;
  /** Set when an action targets a non-active tab; helps the chip explain itself. */
  switchedToTab?: string;
}

/**
 * Structured detail attached to a system transcript message (errors, info
 * banners, retries). Lets the UI render technical detail collapsibly and
 * decide whether to show a Retry button.
 */
export interface SystemNotice {
  kind: "error" | "info";
  /** Short human message shown by default. */
  message: string;
  /** Detail to show when the user expands the bubble (stack, status, etc). */
  technical?: string;
  /** HTTP status code if the failure came from a fetch. */
  status?: number;
  /** Whether the failure category is retryable (timeouts, 5xx, 429). */
  canRetry?: boolean;
  /** How many times the client already retried before surfacing this notice. */
  attempts?: number;
}

/** One turn in the transcript, as displayed to the user and persisted to Postgres. */
export interface TranscriptMessage {
  id: string;
  role: Role;
  text: string;
  /** ISO timestamp. */
  ts: string;
  /** True if this turn included a vision snapshot. */
  hadVision?: boolean;
  /** Tool calls Seneca emitted during this turn. */
  tools?: ToolCallRecord[];
  /** Set when role === "system". */
  notice?: SystemNotice;
}

/** SSE event shapes streamed from /api/chat and /api/vision. */
/**
 * Per-turn token + cost telemetry, emitted once per agent-loop
 * iteration that completes successfully. Phase 4: lets the UI show a
 * live cost pill in the header so the operator can confirm the
 * cheap-text-reads work (Priority 1a/1b) is actually moving the needle.
 *
 * Costs are pre-computed server-side using `apps/api/src/lib/pricing.ts`
 * so the client doesn't need to ship a pricing card — and so the cost
 * pill survives model changes without a frontend redeploy.
 */
export interface UsageStreamEvent {
  type: "usage";
  /** UUID matching the `done` event for the same turn. */
  turnId: string;
  /** Model the iteration ran against (e.g. "claude-sonnet-4-5"). */
  model: string;
  /** Non-cache input tokens consumed. */
  inputTokens: number;
  /** Output tokens streamed. */
  outputTokens: number;
  /** Cache-read input tokens (billed at 10%). */
  cacheReadInputTokens?: number;
  /** Cache-write input tokens (billed at 125%). */
  cacheCreationInputTokens?: number;
  /** Dollar cost split, USD. */
  inputCostUSD: number;
  outputCostUSD: number;
}

/**
 * Server-pushed update of `DocumentsState`. Emitted when a turn-side
 * tool mutates the document collection (currently only
 * `document_create`). The client patches its local `DocumentsState`
 * so the new doc shows up in the sidebar mid-turn — no need to wait
 * for the next session reload.
 */
export interface DocumentsUpdatedStreamEvent {
  type: "documents-updated";
  documents: DocumentsState;
}

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "action"; call: ToolCall }
  | UsageStreamEvent
  | DocumentsUpdatedStreamEvent
  | { type: "done"; turnId: string; fullText: string }
  | { type: "error"; message: string };

/**
 * Per-session rolling cost totals, persisted on the session row and
 * displayed in the header. Bookkeeping is purely additive; we never
 * subtract on undo / retry — the bill itself can't be undone.
 */
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  inputCostUSD: number;
  outputCostUSD: number;
  /**
   * Phase C — characters synthesised through the premium TTS provider
   * (ElevenLabs). Absent on rows that pre-date Phase C; treat
   * `undefined` as `0`.
   */
  ttsCharacters?: number;
  /**
   * Phase C — running ElevenLabs cost in USD, computed client-side
   * using the pricing in `@seneca/shared` so the dashboard agrees with
   * the provider to within a fraction of a cent.
   */
  ttsCostUSD?: number;
  /** When we last received a usage event. ISO timestamp. */
  updatedAt: string;
}

export const DEFAULT_SESSION_USAGE: SessionUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  inputCostUSD: 0,
  outputCostUSD: 0,
  ttsCharacters: 0,
  ttsCostUSD: 0,
  updatedAt: new Date(0).toISOString(),
};

/**
 * Phase C — ElevenLabs character pricing. Hard-coded constant so the
 * client doesn't need a round-trip per turn. Update if ElevenLabs
 * changes their per-character rate.
 *
 * Reference: https://elevenlabs.io/pricing — Creator/Pro plans bill at
 * ~$0.18 / 1k characters for the multilingual streaming models.
 */
export const ELEVENLABS_USD_PER_CHAR = 0.00018;

/** Request body for /api/chat and /api/vision. */
export interface ChatRequest {
  sessionId: string;
  messages: TranscriptMessage[];
  /** Tool results from the previous turn, to be attached to the next user message. */
  toolResults?: ToolResult[];
  /** If present, attached as an image content block on the next user message. */
  image?: {
    /** Base64-encoded data (no data URL prefix). */
    base64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  };
  /** User-authored instructions injected into the system prompt. */
  customInstructions?: {
    aboutYou: string;
    howToRespond: string;
  };
}

/** Persisted whiteboard scene shape we store as JSONB. Wraps Excalidraw's scene. */
export interface WhiteboardState {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

/** Which tile layer the map is currently showing. */
export type MapLayer = "standard" | "satellite";

/** A single labelled marker on the map. */
export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}

/** A polyline or polygon overlaid on the map. Points are [lat, lng] pairs. */
export interface MapShape {
  id: string;
  type: "polyline" | "polygon";
  points: [number, number][];
  label?: string;
  /** Optional stroke colour; defaults to a brand accent on the client. */
  color?: string;
}

/** Persisted map state we store as JSONB. */
export interface MapState {
  /** Map centre as [lat, lng]. */
  center: [number, number];
  zoom: number;
  layer: MapLayer;
  pins: MapPin[];
  shapes: MapShape[];
}

/** Default map view used when a fresh session is created. Global view, neutral. */
export const DEFAULT_MAP_STATE: MapState = {
  center: [20, 0],
  zoom: 2,
  layer: "standard",
  pins: [],
  shapes: [],
};

/**
 * Outcome of server-side text extraction.
 *
 *   - "pending":   record was created before extraction ran (e.g. legacy
 *                  uploads predating Priority 1a). Extraction is performed
 *                  lazily on the first read.
 *   - "extracted": every page has usable text; cheap reads via
 *                  `document_read_page`.
 *   - "scanned":   pages have so little text that the doc looks scanned /
 *                  image-only. The server falls back to rendering the page
 *                  as a PNG and feeds it back as a multimodal tool_result
 *                  so Seneca can read it visually without asking the user
 *                  to toggle the eye icon.
 *   - "failed":    extraction crashed for non-recoverable reasons. The
 *                  read tool will surface this so Seneca can apologise.
 */
export type DocumentTextStatus =
  | "pending"
  | "extracted"
  | "scanned"
  | "failed";

/**
 * Extracted plain text for one page of a document. We keep page granularity
 * (rather than a single concatenated blob) so every downstream feature —
 * read-by-page, search, RAG — works from the same per-page index.
 */
export interface DocumentPageText {
  /** 1-indexed page number. */
  page: number;
  /** Joined, whitespace-collapsed text content for the page. */
  text: string;
  /** Convenience field; equals `text.length`. Useful for "scanned" detection. */
  charCount: number;
}

/**
 * One row in the chunk + embedding index used by `document_search`.
 *
 * Chunks are produced by splitting each `DocumentPageText.text` into
 * ~500-token windows with ~50-token overlap (see `pdfChunker.ts`). The
 * `page` field is preserved on every chunk so a hit can navigate the
 * user to the relevant page with `document_go_to_page` afterwards.
 */
export interface DocumentChunkRow {
  /** 1-indexed page the chunk originated from. */
  page: number;
  /** Position in the chunk stream; stable on re-index. */
  chunkIndex: number;
  /** Raw chunk text (whitespace-collapsed). */
  text: string;
  /** Dense embedding produced by the Voyage AI client. */
  embedding: number[];
}

/**
 * A search hit returned by the chunk store's `topK` lookup. The
 * `score` is a normalised cosine similarity in `[0, 1]`.
 */
export interface DocumentChunkHit {
  documentId: string;
  page: number;
  chunkIndex: number;
  text: string;
  score: number;
}

/**
 * Persisted metadata for a single uploaded document. The actual PDF bytes
 * live in Supabase Storage (real-auth) or a process-local Map (dev-bypass);
 * only this metadata round-trips through Postgres / the JSONB column.
 */
export interface DocumentRecord {
  /** Server-generated UUID. */
  id: string;
  /** Human-friendly name (defaults to filename without extension). */
  name: string;
  /** Original filename including extension. */
  filename: string;
  /** Bytes on disk; used for sidebar size readouts. */
  size: number;
  /** Total pages, populated after the client renders the PDF for the first time. */
  pageCount: number;
  /** Currently displayed page (1-indexed). Persists with the session. */
  currentPage: number;
  /** ISO timestamp the upload landed. */
  uploadedAt: string;
  /**
   * Outcome of server-side text extraction. Absent on legacy records
   * uploaded before Priority 1a; the API treats `undefined` as `"pending"`.
   */
  textStatus?: DocumentTextStatus;
  /**
   * ISO timestamp of the most recent successful text extraction. `null`
   * (or absent) means extraction has not run yet.
   */
  extractedAt?: string | null;
  /**
   * Outcome of server-side embedding indexing. Parallel to `textStatus`
   * but for the chunk-level embeddings that power `document_search`.
   * Absent on legacy records uploaded before Priority 1b; the API treats
   * `undefined` as `"pending"`.
   */
  indexStatus?: DocumentIndexStatus;
  /**
   * ISO timestamp of the most recent successful indexing run. `null` (or
   * absent) means indexing has not produced a usable embedding set yet —
   * `document_search` will degrade to substring scoring.
   */
  indexedAt?: string | null;
  /**
   * Phase 5 / Priority 1c: original mime type. Absent on legacy records
   * uploaded before multi-format support; the API treats `undefined` as
   * `"application/pdf"` (which is what the upload-only-PDF days
   * produced).
   */
  mime?: string;
  /**
   * Phase 5 / Priority 1c: hint to the DocumentTab on which renderer to
   * mount. PDFs stay on the existing react-pdf path (`"pdfjs"`); plain
   * text / markdown / docx render as themed markdown
   * (`"markdown"`); sanitised HTML renders in a sandboxed iframe
   * (`"html"`). Absent on legacy records — treat as `"pdfjs"`.
   */
  renderHint?: DocumentRenderHint;
  /**
   * Phase 6 / Priority 1d: provenance of the document.
   *   - `"upload"`: the user dragged or picked the file. The default for
   *     every record up through Phase 5.
   *   - `"ai-created"`: Seneca authored the doc via the `document_create`
   *     tool. No bytes blob exists for these — the markdown body lives
   *     inline in `document_pages`. The sidebar shows a small "✦" badge.
   * Absent on legacy records — treat as `"upload"`.
   */
  origin?: DocumentOrigin;
}

/**
 * Where this document came from. Used by the sidebar to badge AI-authored
 * drafts and by the upload route to know whether to expect a bytes blob.
 */
export type DocumentOrigin = "upload" | "ai-created";

/**
 * Which front-end renderer the DocumentTab should mount for this
 * record. Extractors set this at upload time; the tab branches on it
 * without re-inspecting the bytes.
 */
export type DocumentRenderHint = "pdfjs" | "markdown" | "html";

/**
 * State of the chunk-level embedding index used by `document_search`.
 *
 *   - "pending":  upload landed but indexing hasn't started (legacy or
 *                 currently failing the Voyage key check).
 *   - "indexing": embeddings call is in flight; sidebar shows a spinner.
 *   - "indexed":  every page's chunks are embedded and queryable. Search
 *                 returns ranked cosine hits.
 *   - "skipped":  no extracted text to embed (scanned PDF, extraction
 *                 failed). Search falls back to substring on what we have.
 *   - "failed":   the embeddings provider or pgvector errored. Search
 *                 falls back to substring; we'll retry on demand.
 */
export type DocumentIndexStatus =
  | "pending"
  | "indexing"
  | "indexed"
  | "skipped"
  | "failed";

/** Persisted state for the documents tab. */
export interface DocumentsState {
  items: DocumentRecord[];
  /** ID of the document showing in the viewer; null when nothing is loaded. */
  activeId: string | null;
}

export const DEFAULT_DOCUMENTS_STATE: DocumentsState = {
  items: [],
  activeId: null,
};

/** A single search result rendered as a card in the web tab. */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Persisted state for the web tab. We deliberately do NOT persist the
 * sanitised HTML — refetching on reload keeps the JSONB column small and
 * sidesteps cache invalidation. Search results are also transient.
 */
export interface WebState {
  /** Currently rendered URL, or null when nothing has been navigated to. */
  url: string | null;
  /** Stack of URLs the user has navigated through this session. */
  history: string[];
  /** Index into `history`. -1 when history is empty. */
  historyIndex: number;
}

export const DEFAULT_WEB_STATE: WebState = {
  url: null,
  history: [],
  historyIndex: -1,
};

/** Sessions row shape. */
export interface SessionRecord {
  id: string;
  user_id: string;
  name: string;
  transcript: TranscriptMessage[];
  whiteboard: WhiteboardState;
  map: MapState;
  web: WebState;
  documents: DocumentsState;
  /**
   * Phase 4: rolling per-session token + USD totals. Optional so older
   * rows without the column read back fine and we can lazily backfill
   * once a turn runs against them.
   */
  usage?: SessionUsage;
  /**
   * Phase D — true when the user has starred this session. Pinned
   * sessions sort to the top of the sessions list / modal. Absent on
   * rows that pre-date the migration; treat `undefined` as `false`.
   */
  pinned?: boolean;
  created_at: string;
  updated_at: string;
}
