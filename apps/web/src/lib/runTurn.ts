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
import {
  buildWorkspaceContext,
  markVisionCaptureFailed,
} from "./workspaceContext";
import { createStreamingChunker } from "./sentenceStream";
import { ttsLog } from "./ttsTimeline";
import { useSenecaStore } from "../store/seneca";

export interface RunTurnInput {
  userText: string;
  /**
   * Sentence-streaming TTS callback. Fired multiple times per turn
   * with sentence-sized chunks as Anthropic's text deltas arrive —
   * the consumer pipes each chunk into a queue-based TTS engine so
   * audio starts playing while the rest of the response (and any
   * interleaved tool calls) is still in flight. This is what gives
   * the conversation a "tandem" feel: Seneca starts talking
   * immediately and the canvas updates while he speaks.
   *
   * The callback may also receive a final tail chunk on stream end.
   * If the user barges in mid-stream, the in-flight buffer is
   * discarded (the audio queue is cleared separately).
   */
  onSpoken?: (text: string) => void;
}

interface RetryInput {
  onSpoken?: (text: string) => void;
}

const MAX_AUTO_RETRIES = 1;
const RETRY_BACKOFF_MS = 700;

/**
 * Module-level abort controller for the currently-running turn.
 *
 * Phase F follow-up — true barge-in: when the user interrupts
 * Seneca mid-response, we want to (a) kill TTS playback, AND
 * (b) abort the streaming chat fetch so we stop paying for
 * tokens the user will never hear. The voice pane calls
 * `abortActiveTurn()` from its interrupt effect; we set this
 * fresh at the start of every `executeTurnOnce` and clear it
 * when the turn ends.
 */
let activeTurnAbort: AbortController | null = null;

/**
 * Cancels any in-flight `/api/chat` (or `/api/vision`) stream.
 * Safe to call when no turn is running — it's a no-op. Use this
 * for barge-in / explicit user interruption.
 */
export function abortActiveTurn(reason = "user_interrupted"): void {
  if (activeTurnAbort) {
    activeTurnAbort.abort(reason);
    activeTurnAbort = null;
  }
}

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
    // User sent a new message while the prior stream was still open
    // (e.g. during tool execution). Abort and reset so this turn runs.
    abortActiveTurn("new_user_turn");
    useSenecaStore.getState().resetStreaming();
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
      } else {
        markVisionCaptureFailed();
      }
    } catch (err) {
      console.warn("[seneca] vision capture failed", err);
      markVisionCaptureFailed();
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
  // Phase F follow-up — annotate interrupted assistant messages
  // with an inline `[... interrupted]` marker before sending so
  // Seneca knows on the next turn that his previous reply was cut
  // short. This is the lightweight version of "tag context as
  // interrupted" — no API schema change, but enough signal for
  // the model to acknowledge ("you stopped me — what's up?") and
  // not robotically repeat itself.
  const messagesToSend = useSenecaStore
    .getState()
    .transcript.filter((m) => m.role !== "system")
    .map((m) =>
      m.role === "seneca" && m.interrupted
        ? {
            ...m,
            text: `${m.text}\n\n[... user interrupted me here]`,
          }
        : m,
    );

  const path = image ? "/api/vision" : "/api/chat";
  let fullText = "";
  let serverError: { type: "error"; message: string } | null = null;

  const { customInstructions } = readPrefs();
  const hasInstructions =
    customInstructions.aboutYou.trim() || customInstructions.howToRespond.trim();

  // Phase F follow-up — fresh AbortController per turn so the
  // voice pane can call `abortActiveTurn()` when the user
  // barges in.
  const abort = new AbortController();
  activeTurnAbort = abort;

  // Sentence-streaming TTS chunker. Every text delta is appended;
  // any complete sentences (or paragraph breaks) bubble out as
  // chunks we immediately ship to onSpoken so the audio queue
  // can start playing while the rest of the turn is still
  // streaming. Crucially, this means tool calls that fire BETWEEN
  // text bursts no longer block the spoken response — Seneca
  // starts talking as soon as he has a complete thought, then
  // pauses naturally while tools execute, then resumes when more
  // text arrives. That's the "tandem" feel: talking and acting
  // at the same time.
  const chunker = createStreamingChunker();
  let lastTextVisibleLogMs = 0;
  const spokenToolIds = new Set<string>();
  const flushChunks = (chunks: string[]) => {
    if (!input.onSpoken) return;
    for (const c of chunks) input.onSpoken(c);
  };
  const flushChunkerRemainder = () => {
    const pending = chunker.flush();
    if (pending.length > 0) flushChunks(pending);
  };

  try {
    await apiStream(
      path,
      {
        sessionId,
        messages: messagesToSend,
        image,
        customInstructions: hasInstructions ? customInstructions : undefined,
        workspaceContext: buildWorkspaceContext(),
        toolResults: drainedToolResults.length > 0 ? drainedToolResults : undefined,
      },
      {
        signal: abort.signal,
        onError: (err) => {
          // Intentional barge-in / new message — not a failure.
          if (
            err instanceof DOMException &&
            (err.name === "AbortError" || err.code === DOMException.ABORT_ERR)
          ) {
            return;
          }
          console.error("[seneca] stream error", err);
        },
        onEvent: (e) => {
          if (e.type === "text") {
            fullText += e.delta;
            useSenecaStore.getState().appendPartial(e.delta);
            const now = performance.now();
            if (now - lastTextVisibleLogMs >= 300) {
              lastTextVisibleLogMs = now;
              ttsLog("runTurn.textVisible", {
                totalChars: fullText.length,
                preview: fullText.slice(-80),
              });
            }
            flushChunks(chunker.push(e.delta));
          } else if (e.type === "action") {
            if (!spokenToolIds.has(e.call.id)) {
              spokenToolIds.add(e.call.id);
              ttsLog("runTurn.toolStart", {
                tool: e.call.name,
                totalChars: fullText.length,
              });
            }
            // Speak any buffered text before tools run so we don't merge
            // "quickly." + "One" across the tool gap into one TTS clip.
            flushChunkerRemainder();
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
                output: result.output,
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
    activeTurnAbort = null;
    // AbortError = the user barged in. Commit whatever text
    // arrived as a normal (truncated) assistant turn so the
    // transcript has a record, but don't surface a "request
    // failed" error notice — it's a deliberate cancellation.
    // We deliberately do NOT flush the chunker tail here: the
    // user is talking; we don't want to immediately speak a
    // half-sentence after the audio queue was just cleared.
    chunker.reset();
    if (
      err instanceof DOMException &&
      err.name === "AbortError"
    ) {
      // Snapshot pending tool calls BEFORE resetStreaming wipes
      // them. This is the load-bearing part of the barge-in
      // contract: any tool_use blocks the server emitted before
      // the abort must be persisted on the assistant message,
      // because their results may finish dispatching after the
      // abort and land in the cross-turn `toolResults` queue.
      // The NEXT turn's request will contain those `tool_result`
      // blocks, and Anthropic requires a matching `tool_use` to
      // live in the previous assistant message — orphan
      // `tool_result`s trigger:
      //   400 messages.N.content.0: unexpected `tool_use_id`
      //       found in `tool_result` blocks
      // Mirrors the success path's `tools` snapshot below.
      const interruptedTools = [
        ...useSenecaStore.getState().streaming.pendingActionLog,
      ];
      const partialText = fullText.trim();
      if (partialText.length > 0 || interruptedTools.length > 0) {
        useSenecaStore.getState().appendTranscript({
          id: turnId,
          role: "seneca",
          text: partialText,
          ts: new Date().toISOString(),
          interrupted: true,
          tools: interruptedTools.length > 0 ? interruptedTools : undefined,
        });
      }
      useSenecaStore.getState().resetStreaming();
      return { ok: true, error: null };
    }
    useSenecaStore.getState().resetStreaming();
    return { ok: false, error: err };
  }
  activeTurnAbort = null;

  if (serverError) {
    useSenecaStore.getState().resetStreaming();
    return {
      ok: false,
      error: new Error((serverError as { message: string }).message),
    };
  }

  // Flush any tail that didn't reach a sentence boundary — e.g. a
  // response that ends without final punctuation — so the user
  // hears the closing thought. Audio was already streaming
  // sentence-by-sentence during the turn; this just catches the
  // tail.
  flushChunks(chunker.flush());

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
  if (status === 403 && /cost_capped/i.test(raw)) {
    return "Daily cost cap reached. Try again after midnight UTC, or raise COST_CAP_USD_PER_DAY in the API env.";
  }
  if (status === 404) return "Session not found on the server.";
  if (status === 429) {
    if (/rate_limited/i.test(raw) || /turns?/i.test(raw)) {
      return "You've hit Seneca's per-hour rate limit. Take a breath and try again in a minute.";
    }
    return "Rate limited by the model.";
  }
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
