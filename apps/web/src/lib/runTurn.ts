/**
 * Orchestrates a single conversation turn:
 *
 *  1. Append the user's message to the transcript.
 *  2. If 👁 is on, capture a snapshot of the active tab.
 *  3. POST to /api/chat (or /api/vision) and stream events back.
 *  4. As text deltas arrive, accumulate them on the streaming slice
 *     (the UI renders the partial bubble live).
 *  5. As action calls complete, dispatch them and queue ToolResults for
 *     the next request.
 *  6. On done, commit the assistant turn to the transcript (with the
 *     tool calls attached) and speak it.
 *  7. If 👁 was armed (not pinned), flip it back off.
 *
 * Failure handling:
 *   - Auto-retry once on transient HTTP errors (status 0/5xx/429/etc).
 *   - On final failure, append a system error transcript entry with a
 *     "Retry" affordance so the user can re-run the same turn.
 */

import type {
  ChatRequest,
  SystemNotice,
  ToolResult,
  TranscriptMessage,
} from "@seneca/shared";
import { ApiError, apiStream, isTransientStatus } from "./api";
import { captureActiveTab } from "./captureCanvas";
import { dispatchToolCall } from "./actionDispatcher";
import { readPrefs } from "./userPreferences";
import { useSenecaStore } from "../store/seneca";

export interface RunTurnInput {
  userText: string;
  /** Optional callback fired with the final assistant text (for TTS). */
  onSpoken?: (text: string) => void;
}

interface RetryInput {
  onSpoken?: (text: string) => void;
}

const MAX_AUTO_RETRIES = 1;
const RETRY_BACKOFF_MS = 700;

/** Public entry point: append the user's message and run the turn. */
export async function runTurn({
  userText,
  onSpoken,
}: RunTurnInput): Promise<void> {
  const trimmed = userText.trim();
  if (!trimmed) return;

  const state = useSenecaStore.getState();
  if (!state.session.id) {
    console.warn("[seneca] no active session; ignoring user input");
    return;
  }
  if (state.streaming.activeTurnId) {
    console.warn("[seneca] a turn is already in flight; ignoring");
    return;
  }

  const userMsg: TranscriptMessage = {
    id: crypto.randomUUID(),
    role: "user",
    text: trimmed,
    ts: new Date().toISOString(),
    hadVision: state.vision.enabled || undefined,
  };
  useSenecaStore.getState().appendTranscript(userMsg);

  await executeTurnWithRetry({ onSpoken });
}

/**
 * Re-run the turn whose response failed. Removes the trailing system
 * error message (and any partial Seneca turn) before re-executing
 * against the same prior user message.
 */
export async function retryLastTurn({ onSpoken }: RetryInput): Promise<void> {
  const store = useSenecaStore.getState();
  if (store.streaming.activeTurnId) return;

  // Trim trailing system / empty seneca entries to land on the user message.
  let transcript = [...store.transcript];
  while (transcript.length > 0) {
    const last = transcript[transcript.length - 1]!;
    if (last.role === "system") {
      transcript = transcript.slice(0, -1);
      continue;
    }
    if (last.role === "seneca" && !last.text.trim()) {
      transcript = transcript.slice(0, -1);
      continue;
    }
    break;
  }
  store.setTranscript(transcript);

  const tail = transcript[transcript.length - 1];
  if (!tail || tail.role !== "user") {
    console.warn("[seneca] nothing to retry");
    return;
  }
  await executeTurnWithRetry({ onSpoken });
}

async function executeTurnWithRetry(input: RetryInput): Promise<void> {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= MAX_AUTO_RETRIES) {
    const result = await executeTurnOnce(input);
    if (result.ok) return;
    lastError = result.error;

    const transient = isTransientError(result.error);
    if (!transient || attempt === MAX_AUTO_RETRIES) {
      appendSystemError(result.error, attempt + 1, transient);
      return;
    }
    attempt++;
    await sleep(RETRY_BACKOFF_MS * attempt);
  }

  // Defensive — should be unreachable.
  appendSystemError(lastError, attempt + 1, true);
}

interface ExecuteResult {
  ok: boolean;
  error: unknown;
}

async function executeTurnOnce(input: RetryInput): Promise<ExecuteResult> {
  const state = useSenecaStore.getState();
  const sessionId = state.session.id;
  if (!sessionId) return { ok: false, error: new Error("No active session") };

  // Snapshot canvas if vision is on.
  let image: ChatRequest["image"] | undefined;
  if (state.vision.enabled) {
    try {
      const captured = await captureActiveTab(state.activeTab);
      if (captured) {
        image = { base64: captured.base64, mimeType: "image/png" };
      }
    } catch (err) {
      console.warn("[seneca] vision capture failed", err);
    }
  }

  const turnId = crypto.randomUUID();
  useSenecaStore.getState().beginTurn(turnId);

  // Cross-turn tool_result forwarding (Phase 3). Drain whatever the
  // dispatcher queued during the LAST turn so we can attach it to this
  // turn's request — the server prepends these to the latest user
  // message so Claude sees how its prior tools actually fared.
  const drainedToolResults: ToolResult[] = useSenecaStore
    .getState()
    .drainToolResults();
  const messagesToSend = useSenecaStore
    .getState()
    .transcript.filter((m) => m.role !== "system");

  const path = image ? "/api/vision" : "/api/chat";
  let fullText = "";
  let serverError: { type: "error"; message: string } | null = null;

  const { customInstructions } = readPrefs();
  const hasInstructions =
    customInstructions.aboutYou.trim() || customInstructions.howToRespond.trim();

  try {
    await apiStream(
      path,
      {
        sessionId,
        messages: messagesToSend,
        image,
        customInstructions: hasInstructions ? customInstructions : undefined,
        toolResults: drainedToolResults.length > 0 ? drainedToolResults : undefined,
      },
      {
        onError: (err) => {
          console.error("[seneca] stream error", err);
        },
        onEvent: (e) => {
          if (e.type === "text") {
            fullText += e.delta;
            useSenecaStore.getState().appendPartial(e.delta);
          } else if (e.type === "action") {
            useSenecaStore.getState().pushPendingAction({
              id: e.call.id,
              name: e.call.name,
              input: e.call.input,
            });
            // Dispatch locally, then queue a ToolResult so the NEXT
            // request can attach it as a `tool_result` block (Phase 3).
            // Success cases use a short "ok" so the next turn doesn't
            // re-explain context; failures carry the dispatcher's
            // human-readable error so Claude can apologise gracefully.
            void dispatchToolCall(e.call).then((result) => {
              useSenecaStore.getState().updatePendingAction(e.call.id, {
                ok: result.ok,
                error: result.error,
              });
              useSenecaStore.getState().enqueueToolResult({
                toolUseId: e.call.id,
                ok: result.ok,
                error: result.error,
              });
            });
          } else if (e.type === "usage") {
            // Phase 4: per-turn cost. The store does the accumulator
            // math so the header pill can show "$0.04 turn · $0.61 session"
            // without a derived selector everywhere.
            useSenecaStore.getState().applyUsageEvent(e);
          } else if (e.type === "documents-updated") {
            // Phase 6: a server-fulfilled tool (e.g. `document_create`)
            // mutated the session's DocumentsState. Patch the local
            // store so the sidebar reflects the new entry without a
            // full session reload.
            useSenecaStore.getState().setDocuments(e.documents);
          } else if (e.type === "done") {
            fullText = e.fullText;
          } else if (e.type === "error") {
            serverError = e;
          }
        },
      },
    );
  } catch (err) {
    useSenecaStore.getState().resetStreaming();
    return { ok: false, error: err };
  }

  if (serverError) {
    useSenecaStore.getState().resetStreaming();
    return {
      ok: false,
      error: new Error((serverError as { message: string }).message),
    };
  }

  // Commit the Seneca turn (with the tool record snapshot) to the transcript.
  const tools = [...useSenecaStore.getState().streaming.pendingActionLog];
  const finalText = fullText.trim();
  if (finalText.length > 0 || tools.length > 0) {
    useSenecaStore.getState().appendTranscript({
      id: turnId,
      role: "seneca",
      text: finalText,
      ts: new Date().toISOString(),
      hadVision: !!image || undefined,
      tools: tools.length > 0 ? tools : undefined,
    });
    if (finalText) input.onSpoken?.(finalText);
  }

  useSenecaStore.getState().resetStreaming();

  // Auto-revert vision toggle if it was armed-not-pinned.
  const after = useSenecaStore.getState();
  if (after.vision.enabled && !after.vision.pinned) {
    after.setVisionEnabled(false);
  }

  return { ok: true, error: null };
}

function isTransientError(err: unknown): boolean {
  if (err instanceof ApiError) return err.transient;
  if (err instanceof Error) {
    // Plain network errors thrown by fetch (DOMException AbortError etc.)
    if (/network|failed to fetch|load failed/i.test(err.message)) return true;
  }
  return false;
}

function appendSystemError(
  error: unknown,
  attempts: number,
  canRetry: boolean,
): void {
  const status = error instanceof ApiError ? error.status : undefined;
  const message =
    error instanceof Error ? error.message : "Something went wrong.";
  const technical =
    error instanceof Error
      ? (error.stack ?? error.message)
      : JSON.stringify(error);

  const notice: SystemNotice = {
    kind: "error",
    message: friendlyMessage(message, status),
    technical,
    status,
    canRetry,
    attempts,
  };
  useSenecaStore.getState().appendTranscript({
    id: crypto.randomUUID(),
    role: "system",
    text: "",
    ts: new Date().toISOString(),
    notice,
  });
}

function friendlyMessage(raw: string, status: number | undefined): string {
  if (status === 0) return "Couldn't reach the API. Check your connection.";
  if (status === 401)
    return "Authentication failed. Sign out and back in to fix this.";
  if (status === 404) return "Session not found on the server.";
  if (status === 429) return "Rate limited by the model.";
  if (status && status >= 500)
    return `Server error (${status}). The model or API is having a moment.`;
  if (/aborted/i.test(raw)) return "Request was cancelled.";
  if (raw.length > 220) return raw.slice(0, 220) + "…";
  return raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const _internals = {
  isTransientStatus,
};
