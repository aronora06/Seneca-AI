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
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "action"; call: ToolCall }
  | { type: "done"; turnId: string; fullText: string }
  | { type: "error"; message: string };

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
}

/** Persisted whiteboard scene shape we store as JSONB. Wraps Excalidraw's scene. */
export interface WhiteboardState {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

/** Sessions row shape. */
export interface SessionRecord {
  id: string;
  user_id: string;
  name: string;
  transcript: TranscriptMessage[];
  whiteboard: WhiteboardState;
  created_at: string;
  updated_at: string;
}
