import { Router, type Response } from "express";
import type {
  ChatRequest,
  DocumentRecord,
  DocumentsState,
  TranscriptMessage,
  ToolResult,
  WebState,
} from "@seneca/shared";
import {
  ALL_TOOLS,
  formatWorkspaceContextForPrompt,
  SENECA_SYSTEM_PROMPT,
} from "@seneca/shared";
import type { WorkspaceContext } from "@seneca/shared";

import { anthropic, ANTHROPIC_MAX_TOKENS } from "../lib/anthropic.js";
import { documentChunkStore } from "../lib/documentChunkStore.js";
import { _internals as mdInternals } from "../lib/documentExtractors/markdown.js";
import { documentStore } from "../lib/documentStorage.js";
import { documentTextStore } from "../lib/documentTextStore.js";
import { chunkPages } from "../lib/pdfChunker.js";
import {
  extractTextFromPdf,
  SCANNED_PAGE_CHARS_THRESHOLD,
} from "../lib/pdfTextExtractor.js";
import { renderPdfPageToPng } from "../lib/pdfPageRenderer.js";
import { computeCostUSD } from "../lib/pricing.js";
import { openSseStream } from "../lib/sse.js";
import { resolveDiagramRead } from "../lib/diagramRead.js";
import { sessionStore } from "../lib/sessionStore.js";
import {
  embed,
  VoyageNotConfiguredError,
} from "../lib/voyageEmbeddings.js";
import {
  extractTextFromHtml,
  fetchAndSanitise,
  WebProxyError,
} from "../lib/webProxy.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  assertWithinDailyCap,
  peekDailyCost,
  recordDailyCost,
} from "../lib/costCap.js";
import { env } from "../env.js";

export const chatRouter = Router();

chatRouter.post(
  "/api/chat",
  requireAuth,
  rateLimit("chat"),
  (req, res) => {
    void handleTurn(req as AuthedRequest, res, { withVision: false });
  },
);

chatRouter.post(
  "/api/vision",
  requireAuth,
  rateLimit("vision"),
  (req, res) => {
    void handleTurn(req as AuthedRequest, res, { withVision: true });
  },
);

interface HandlerOptions {
  withVision: boolean;
}

function buildSystemPrompt(
  instructions?: { aboutYou: string; howToRespond: string },
  workspace?: WorkspaceContext,
): string {
  const parts: string[] = [SENECA_SYSTEM_PROMPT];
  if (workspace) {
    parts.push("\n\n", formatWorkspaceContextForPrompt(workspace));
  }
  const hasInstructions =
    instructions &&
    (instructions.aboutYou.trim() || instructions.howToRespond.trim());
  if (hasInstructions) {
    parts.push("\n\n<user_context>");
    if (instructions.aboutYou.trim()) {
      parts.push(
        `The user has shared the following about themselves:\n${instructions.aboutYou.trim()}`,
      );
    }
    if (instructions.howToRespond.trim()) {
      parts.push(
        `The user's preferences for how you should respond:\n${instructions.howToRespond.trim()}`,
      );
    }
    parts.push("</user_context>");
  }
  return parts.join("\n");
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
type AnthropicImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";
interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: AnthropicImageMediaType; data: string };
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
/**
 * Tool results can be either a flat string OR an array of typed blocks.
 * The block form is what we use for multimodal results — e.g. the
 * `document_read_page` fallback returns an image block alongside a brief
 * caption so Seneca reads scanned PDFs visually within the same turn.
 */
type AnthropicToolResultContent =
  | string
  | Array<AnthropicTextBlock | AnthropicImageBlock>;
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  is_error?: boolean;
  content: AnthropicToolResultContent;
}
type AnthropicContent =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContent[];
}

/** Hard upper bound on agent loop iterations to keep cost / latency bounded. */
const MAX_AGENT_ITERATIONS = 8;

async function handleTurn(
  req: AuthedRequest,
  res: Response,
  opts: HandlerOptions,
): Promise<void> {
  const body = req.body as Partial<ChatRequest> | undefined;
  if (!body || !body.sessionId || !Array.isArray(body.messages)) {
    res
      .status(400)
      .json({ error: "Body must include { sessionId, messages[] }." });
    return;
  }
  if (opts.withVision && !body.image) {
    res
      .status(400)
      .json({ error: "Vision endpoint requires an `image` payload." });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: "Missing user." });
    return;
  }

  // Phase F — hard daily cost cap. We check at the *start* of the
  // turn so we never start work that the user can't pay for. The
  // accumulator is updated when usage events come back from
  // Anthropic; today's tab on yesterday's date won't block a brand-
  // new day's traffic.
  try {
    assertWithinDailyCap(req.user.id);
  } catch (err) {
    if (
      err instanceof Error &&
      (err as Error & { code?: string }).code === "cost_capped"
    ) {
      const state = peekDailyCost(req.user.id);
      res.status(403).json({
        error: err.message,
        code: "cost_capped",
        used: state.used,
        cap: state.cap,
        resetInSec: state.resetInSec,
      });
      return;
    }
    throw err;
  }

  // Confirm the session belongs to this user before any expensive work.
  // We also pull the persisted web + documents state so the agent loop
  // can resolve `web_read_page` and `document_read_page` against the
  // currently-loaded URL / document without a second round-trip.
  let sessionRow: {
    id: string;
    web: WebState;
    documents: DocumentsState;
    diagrams: import("@seneca/shared").DiagramsState;
  } | null;
  try {
    sessionRow = await sessionStore.getById(
      body.sessionId,
      req.user.id,
      req.jwt,
    );
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (!sessionRow) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const messages: AnthropicMessage[] = buildAnthropicMessages(
    body.messages,
    body.toolResults ?? [],
    opts.withVision ? (body.image ?? null) : null,
  );

  const systemPrompt = buildSystemPrompt(
    body.customInstructions,
    body.workspaceContext,
  );

  const { send, close } = openSseStream(res);

  const turnId = crypto.randomUUID();
  let fullTextAcrossLoop = "";
  // Accumulates every tool_use block Claude emits across agent-loop
  // iterations so we can persist them on the assistant TranscriptMessage.
  // The client also tracks these (via SSE `action` events) and decorates
  // them with `ok` / `error` from local dispatch — those richer records
  // overwrite this server view on the next turn's transcript PUT.
  const assistantToolUsesAcrossLoop: import("@seneca/shared").ToolCallRecord[] =
    [];
  const controller = new AbortController();

  req.on("close", () => {
    controller.abort();
  });

  try {
    const model = opts.withVision
      ? env.anthropicVisionModel
      : env.anthropicTextModel;

    // Track the URL the user is currently looking at within this turn.
    // Starts from persisted state and updates as Claude emits web_navigate
    // tool_use blocks, so a navigate-then-read chain in the same turn
    // reads the freshly-loaded page.
    let activeWebUrl: string | null = sessionRow.web.url;
    // Parallel state for documents: which doc is "in front of" the user
    // right now, and how `document_go_to_page` updates it within a turn
    // so a chained `document_read_page` (without an explicit document_id)
    // reads the just-switched-to doc.
    let activeDocumentId: string | null = sessionRow.documents.activeId;

    // Phase 4: usage accumulator. Anthropic returns a per-call `usage`
    // counter; we sum across iterations so the cost shown to the user
    // includes server-side tool round-trips (the user only "feels" the
    // overall turn, so that's the unit we bill by in the UI).
    const turnUsage: ClaudeTurnUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
      const { textInThisTurn, assistantContent, stopReason, usage } =
        await runOneClaudeTurn(model, systemPrompt, messages, send, controller.signal);

      fullTextAcrossLoop += textInThisTurn;
      // Sum every iteration's usage so the post-loop emit is a true
      // per-turn total. Cast through `Number` to defend against the
      // SDK occasionally returning `null` for cache fields.
      turnUsage.input_tokens += Number(usage.input_tokens ?? 0);
      turnUsage.output_tokens += Number(usage.output_tokens ?? 0);
      turnUsage.cache_read_input_tokens =
        (turnUsage.cache_read_input_tokens ?? 0) +
        Number(usage.cache_read_input_tokens ?? 0);
      turnUsage.cache_creation_input_tokens =
        (turnUsage.cache_creation_input_tokens ?? 0) +
        Number(usage.cache_creation_input_tokens ?? 0);

      if (stopReason !== "tool_use") {
        break;
      }

      // Append the assistant's full content (text + tool_use blocks),
      // then build one tool_result per tool_use block. Most tools are
      // client-fulfilled and get a synthetic "ok" — failures bubble
      // back via the next user turn (handoff tech-debt #1). The reading
      // tools (web_read_page, document_read_page) are resolved here so
      // Claude can get real content without another network round-trip.
      messages.push({ role: "assistant", content: assistantContent });

      const toolUses = assistantContent.filter(
        (b): b is AnthropicToolUseBlock => b.type === "tool_use",
      );

      // Remember every tool_use the model issued so we can persist it.
      for (const tu of toolUses) {
        assistantToolUsesAcrossLoop.push({
          id: tu.id,
          name: tu.name,
          input: tu.input as Record<string, unknown>,
        });
      }

      const results = await Promise.all(
        toolUses.map(async (tu) => {
          // Update the in-turn URL state when Claude navigates so a
          // chained read sees the new page.
          if (tu.name === "web_navigate") {
            const next = (tu.input as { url?: unknown }).url;
            if (typeof next === "string" && next.trim()) {
              activeWebUrl = next.trim();
            }
          }

          // Mirror for documents: when Claude flips pages on a specific
          // document, treat that doc as the active one for the rest of
          // the turn so a chained read sees the same doc.
          if (tu.name === "document_go_to_page") {
            const explicitId = (tu.input as { document_id?: unknown })
              .document_id;
            if (typeof explicitId === "string" && explicitId.trim()) {
              activeDocumentId = explicitId.trim();
            }
          }

          if (tu.name === "web_read_page") {
            const content = await resolveWebReadPage(tu.input, activeWebUrl);
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              is_error: false,
              content,
            };
          }

          if (tu.name === "document_read_page") {
            const resolved = await resolveDocumentReadPage(
              tu.input,
              req.user!.id,
              body.sessionId!,
              activeDocumentId,
              sessionRow!.documents,
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              is_error: resolved.isError,
              content: resolved.content,
            };
          }

          if (tu.name === "document_list") {
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              is_error: false,
              content: resolveDocumentList(sessionRow!.documents),
            };
          }

          if (tu.name === "document_search") {
            const resolved = await resolveDocumentSearch(
              tu.input,
              req.user!.id,
              body.sessionId!,
              sessionRow!.documents,
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              is_error: resolved.isError,
              content: resolved.content,
            };
          }

          if (tu.name === "diagram_read") {
            const content = resolveDiagramRead(
              sessionRow!.diagrams.xml,
              tu.input,
            );
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              is_error: false,
              content,
            };
          }

          if (tu.name === "document_create") {
            // Phase 6 / Priority 1d: server-fulfilled write. The resolver
            // persists the new doc inline (no Storage blob — markdown
            // lives in `document_pages`), updates the session row, and
            // returns the new id. We mutate `sessionRow.documents` and
            // `activeDocumentId` in-place so a chained
            // `document_go_to_page` or `document_search` later in the
            // same turn sees the freshly-created doc.
            const resolved = await resolveDocumentCreate(
              tu.input,
              req.user!.id,
              body.sessionId!,
              req.jwt,
              sessionRow!.documents,
            );
            if (!resolved.isError && resolved.created) {
              sessionRow!.documents = resolved.created.documents;
              activeDocumentId = resolved.created.documentId;
              // Push the new DocumentsState to the client so the
              // sidebar updates mid-turn instead of waiting for the
              // next session reload.
              send({
                type: "documents-updated",
                documents: resolved.created.documents,
              });
            }
            return {
              type: "tool_result" as const,
              tool_use_id: tu.id,
              is_error: resolved.isError,
              content: resolved.content,
            };
          }

          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            is_error: false,
            content: "ok" as const,
          };
        }),
      );

      messages.push({ role: "user", content: results });
    }

    await appendAssistantTurn(
      body.sessionId,
      req.user.id,
      req.jwt,
      body.messages,
      fullTextAcrossLoop,
      turnId,
      opts.withVision,
      assistantToolUsesAcrossLoop,
    );

    // ── Phase 4: emit usage + persist rolling session totals ────────
    const cost = computeCostUSD(model, turnUsage);
    send({
      type: "usage",
      turnId,
      model,
      inputTokens: turnUsage.input_tokens,
      outputTokens: turnUsage.output_tokens,
      cacheReadInputTokens: turnUsage.cache_read_input_tokens ?? undefined,
      cacheCreationInputTokens:
        turnUsage.cache_creation_input_tokens ?? undefined,
      inputCostUSD: cost.inputCostUSD,
      outputCostUSD: cost.outputCostUSD,
    });

    await accumulateSessionUsage(
      body.sessionId,
      req.user.id,
      req.jwt,
      turnUsage,
      cost,
    );

    // Phase F — feed the daily cost accumulator. It's per-user, in
    // memory, and clears at UTC midnight; see costCap.ts for the
    // limits of this approach.
    recordDailyCost(
      req.user.id,
      cost.inputCostUSD + cost.outputCostUSD,
    );

    send({ type: "done", turnId, fullText: fullTextAcrossLoop });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: "error", message: msg });
  } finally {
    close();
  }
}

interface ClaudeTurnUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface ClaudeTurnResult {
  textInThisTurn: string;
  assistantContent: AnthropicContent[];
  stopReason: string | null | undefined;
  usage: ClaudeTurnUsage;
}

/**
 * Runs a single Claude streaming call. Streams text deltas and emits an
 * `action` SSE event for each completed tool_use block. Returns the
 * assembled assistant content so the caller can append it back into the
 * message history for the next iteration.
 */
async function runOneClaudeTurn(
  model: string,
  systemPrompt: string,
  messages: AnthropicMessage[],
  send: (e: import("@seneca/shared").ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<ClaudeTurnResult> {
  const stream = anthropic.messages.stream(
    {
      model,
      system: systemPrompt,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      tools: ALL_TOOLS as unknown as Parameters<
        typeof anthropic.messages.stream
      >[0]["tools"],
      messages,
    },
    { signal },
  );

  let textInThisTurn = "";
  // Tracks tool_use blocks while their input JSON streams in.
  const toolUseInProgress = new Map<
    number,
    { id: string; name: string; partialJson: string }
  >();

  stream.on("text", (delta: string) => {
    if (!delta) return;
    textInThisTurn += delta;
    send({ type: "text", delta });
  });

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use") {
        toolUseInProgress.set(event.index, {
          id: block.id,
          name: block.name,
          partialJson: "",
        });
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "input_json_delta") {
        const entry = toolUseInProgress.get(event.index);
        if (entry) entry.partialJson += event.delta.partial_json;
      }
    } else if (event.type === "content_block_stop") {
      const entry = toolUseInProgress.get(event.index);
      if (!entry) return;
      toolUseInProgress.delete(event.index);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = entry.partialJson.length
          ? (JSON.parse(entry.partialJson) as Record<string, unknown>)
          : {};
      } catch {
        send({
          type: "error",
          message: `Failed to parse tool input for ${entry.name}.`,
        });
        return;
      }
      send({
        type: "action",
        call: { id: entry.id, name: entry.name, input: parsed },
      });
    }
  });

  const finalMessage = await stream.finalMessage();
  const rawUsage = (finalMessage.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  return {
    textInThisTurn,
    assistantContent: finalMessage.content as unknown as AnthropicContent[],
    stopReason: finalMessage.stop_reason,
    usage: {
      input_tokens: rawUsage.input_tokens ?? 0,
      output_tokens: rawUsage.output_tokens ?? 0,
      cache_read_input_tokens: rawUsage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: rawUsage.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * Build the Anthropic `messages` array from our transcript. Tool results
 * from the previous user turn (if any) are prepended to the latest user
 * message so Claude sees how its prior tool calls actually fared. An
 * optional image is attached as a content block before the user text.
 */
function buildAnthropicMessages(
  transcript: TranscriptMessage[],
  toolResults: ToolResult[],
  image: ChatRequest["image"] | null,
): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];

  // Strip system entries; Anthropic only accepts user/assistant turns.
  const visible = transcript.filter((m) => m.role !== "system");

  // Index the live `toolResults` by id so the freshest client-side
  // dispatch outcome (success / failure / structured output) wins over
  // whatever we synthesise from the persisted assistant turn.
  const liveById = new Map<string, ToolResult>();
  for (const tr of toolResults) liveById.set(tr.toolUseId, tr);

  for (let i = 0; i < visible.length; i++) {
    const msg = visible[i]!;
    const isLast = i === visible.length - 1;

    if (msg.role === "user") {
      const content: AnthropicContent[] = [];

      // If the PRIOR assistant turn issued tool_use blocks, Anthropic
      // requires the next user message to start with matching
      // tool_result blocks. We synthesise these from the persisted
      // `tools` records — they carry `ok` / `error` flags filled in by
      // the client's dispatcher. Live `toolResults` from the request
      // body override per-id for the most recent user turn.
      const prior = i > 0 ? visible[i - 1] : null;
      if (prior && prior.role === "seneca" && prior.tools?.length) {
        for (const tc of prior.tools) {
          const live = liveById.get(tc.id);
          if (live) {
            content.push({
              type: "tool_result",
              tool_use_id: live.toolUseId,
              is_error: !live.ok,
              content: live.ok
                ? typeof live.output === "string"
                  ? live.output
                  : JSON.stringify(live.output ?? { ok: true })
                : (live.error ?? "Tool call failed."),
            });
            liveById.delete(live.toolUseId);
          } else {
            content.push({
              type: "tool_result",
              tool_use_id: tc.id,
              is_error: tc.ok === false,
              content:
                tc.ok === false
                  ? (tc.error ?? "Tool call failed.")
                  : "ok",
            });
          }
        }
      }

      // Any live results that didn't map to a persisted tool_use still
      // need to land somewhere; we attach them to the latest user turn
      // so the loop doesn't silently drop them. (Belt-and-braces — in
      // practice every live result should match a persisted id.)
      if (isLast && liveById.size > 0) {
        for (const tr of liveById.values()) {
          content.push({
            type: "tool_result",
            tool_use_id: tr.toolUseId,
            is_error: !tr.ok,
            content: tr.ok
              ? typeof tr.output === "string"
                ? tr.output
                : JSON.stringify(tr.output ?? { ok: true })
              : (tr.error ?? "Tool call failed."),
          });
        }
      }

      if (isLast && image) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mimeType,
            data: image.base64,
          },
        });
      }

      content.push({ type: "text", text: msg.text });
      out.push({ role: "user", content });
    } else {
      // Assistant turn. Echo any persisted tool_use blocks alongside
      // the streamed text so Anthropic doesn't see orphan tool_use_ids
      // when the next user turn references them.
      const content: AnthropicContent[] = [];
      if (msg.text.trim().length > 0) {
        content.push({ type: "text", text: msg.text });
      }
      if (msg.tools && msg.tools.length > 0) {
        for (const tc of msg.tools) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
      }
      // Anthropic rejects empty assistant content — fall back to a
      // single empty-text block in the (vanishingly unlikely) case
      // where neither text nor tools were persisted.
      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }
      out.push({ role: "assistant", content });
    }
  }

  return out;
}

/**
 * Resolve a `web_read_page` tool_use into the text content the model
 * should see in its `tool_result`. Uses the explicit `url` input when
 * present, falls back to the in-turn active URL (updated on every
 * `web_navigate`), then to the persisted session URL. Errors are
 * returned as a JSON envelope so Claude can apologise gracefully
 * rather than the whole turn 500ing.
 */
async function resolveWebReadPage(
  rawInput: unknown,
  activeUrl: string | null,
): Promise<string> {
  const input = (rawInput ?? {}) as { url?: unknown; max_chars?: unknown };
  const explicit =
    typeof input.url === "string" && input.url.trim()
      ? input.url.trim()
      : null;
  const url = explicit ?? activeUrl;

  if (!url) {
    return JSON.stringify({
      error:
        "No web URL is loaded. Use web_navigate first, or call web_read_page with a `url` argument.",
    });
  }

  const cap = clampMaxChars(input.max_chars);

  try {
    const page = await fetchAndSanitise(url);
    const { text, truncated } = extractTextFromHtml(page.html, cap);
    return JSON.stringify({
      url: page.finalUrl,
      title: page.title,
      truncated,
      max_chars: cap,
      text,
    });
  } catch (err) {
    if (err instanceof WebProxyError) {
      return JSON.stringify({ error: err.message, code: err.code });
    }
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function clampMaxChars(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 12_000;
  if (n < 500) return 500;
  if (n > 30_000) return 30_000;
  return Math.floor(n);
}

interface DocumentReadResolution {
  isError: boolean;
  content: AnthropicToolResultContent;
}

/**
 * Resolve a `document_read_page` tool_use.
 *
 * Resolution order for the target document:
 *   1. `input.document_id` if explicitly provided.
 *   2. The in-turn `activeDocumentId` (updated by `document_go_to_page`
 *      calls within the same agent loop iteration).
 *   3. The session's persisted activeId.
 *
 * Resolution order for the text itself:
 *   1. Per-page row from the text store (the fast path for any doc that
 *      was extracted at upload time).
 *   2. Lazy extraction: pull the bytes, run extractTextFromPdf, write
 *      the result back to the text store, retry. Catches legacy uploads
 *      from before Priority 1a, and the rare case where the upload-time
 *      extraction failed but the bytes survived.
 *
 * When the resolved page text is too short to be useful — typically a
 * scanned PDF — the resolver returns a *multimodal* tool_result with the
 * page rendered as a PNG. Seneca reads it visually within the same
 * iteration, and the user never has to enable vision capture.
 *
 * All failure modes return a JSON envelope as a string with `is_error:
 * true` so Claude can apologise rather than the whole turn 500ing.
 */
async function resolveDocumentReadPage(
  rawInput: unknown,
  userId: string,
  sessionId: string,
  activeDocumentId: string | null,
  persistedDocs: DocumentsState,
): Promise<DocumentReadResolution> {
  const input = (rawInput ?? {}) as {
    page?: unknown;
    document_id?: unknown;
    max_chars?: unknown;
  };

  // ── target doc resolution ──────────────────────────────────────────────
  const explicitDocId =
    typeof input.document_id === "string" && input.document_id.trim()
      ? input.document_id.trim()
      : null;
  const docId = explicitDocId ?? activeDocumentId ?? persistedDocs.activeId;
  if (!docId) {
    return errorResult(
      "No document is loaded. Ask the user to upload a PDF, or call this tool with a `document_id`.",
    );
  }

  const record = persistedDocs.items.find((d) => d.id === docId) ?? null;
  if (!record) {
    return errorResult(
      `Document ${docId} is not in this session. The user can see their loaded documents in the sidebar.`,
    );
  }

  // ── page-number resolution + clamp ─────────────────────────────────────
  const pageRaw = Number(input.page);
  if (!Number.isFinite(pageRaw)) {
    return errorResult("`page` must be a finite number.");
  }
  // pageCount can be 0 on legacy records — fall back to the extracted
  // text we may already have to learn the real bound.
  let pageBound = record.pageCount > 0 ? record.pageCount : 0;
  if (pageBound === 0) {
    const sample = await documentTextStore
      .getAll(userId, sessionId, docId)
      .catch(() => null);
    if (sample && sample.length > 0) pageBound = sample.length;
  }
  const page = clampPage(pageRaw, pageBound);
  const cap = clampMaxChars(input.max_chars);

  // ── try the text store ─────────────────────────────────────────────────
  let pageText = await documentTextStore
    .getPage(userId, sessionId, docId, page)
    .catch(() => null);

  // ── lazy extraction if no row exists yet ───────────────────────────────
  if (!pageText) {
    const bytes = await documentStore
      .get(userId, sessionId, docId)
      .catch(() => null);
    if (!bytes) {
      return errorResult(
        "Couldn't fetch the document bytes from storage — the file may have been deleted.",
      );
    }
    try {
      const result = await extractTextFromPdf(bytes.bytes);
      await documentTextStore
        .put(userId, sessionId, docId, result.pages)
        .catch(() => undefined);
      pageText =
        result.pages.find((p) => p.page === page) ?? null;
      if (!pageText) {
        return errorResult(
          `Page ${page} is out of range. This document has ${result.pages.length} pages.`,
        );
      }
    } catch (err) {
      // Fall through to render-as-image — the doc may be unparseable
      // for text but still renderable.
      console.warn(
        "[seneca] lazy text extraction failed; trying visual fallback",
        err instanceof Error ? err.message : err,
      );
      pageText = { page, text: "", charCount: 0 };
    }
  }

  // ── if we have enough text, return it directly ─────────────────────────
  if (pageText.charCount >= SCANNED_PAGE_CHARS_THRESHOLD) {
    const text =
      pageText.text.length > cap
        ? pageText.text.slice(0, cap)
        : pageText.text;
    return {
      isError: false,
      content: JSON.stringify({
        documentId: docId,
        documentName: record.name,
        page,
        pageCount: pageBound || record.pageCount,
        charCount: pageText.charCount,
        truncated: pageText.text.length > cap,
        max_chars: cap,
        text,
      }),
    };
  }

  // ── otherwise: render the page server-side as a PNG fallback ───────────
  //
  // This is the "Seneca enables vision for himself" path: a scanned PDF
  // (or any page with no usable embedded text) is rasterised and fed
  // back as a multimodal tool_result image. The user never has to flip
  // the eye toggle. We send a brief text caption alongside so Seneca
  // knows what he's looking at.
  try {
    const bytes = await documentStore.get(userId, sessionId, docId);
    if (!bytes) {
      return errorResult(
        "Couldn't fetch the document bytes for visual rendering.",
      );
    }
    const rendered = await renderPdfPageToPng(bytes.bytes, page);
    return {
      isError: false,
      content: [
        {
          type: "text",
          text: `Page ${page} of "${record.name}" had no extractable text (the document appears scanned or image-based). Here is the rendered page so you can read it visually:`,
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: rendered.png.toString("base64"),
          },
        },
      ],
    };
  } catch (err) {
    return errorResult(
      `Couldn't render page ${page} as an image: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function errorResult(message: string): DocumentReadResolution {
  return {
    isError: true,
    content: JSON.stringify({ error: message }),
  };
}

function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return Math.max(1, Math.floor(page));
  if (page < 1) return 1;
  if (page > pageCount) return pageCount;
  return Math.floor(page);
}

/**
 * Resolve a `document_list` tool_use. Pure read against the session row —
 * no IO required. We project the persisted DocumentsState into a compact
 * shape with an `active` flag so Seneca can immediately pick which doc to
 * read or search next without a second round-trip.
 */
function resolveDocumentList(docs: DocumentsState): string {
  const items = docs.items.map((d) => ({
    id: d.id,
    name: d.name,
    filename: d.filename,
    pageCount: d.pageCount,
    currentPage: d.currentPage,
    textStatus: d.textStatus ?? "pending",
    active: d.id === docs.activeId,
  }));
  return JSON.stringify({
    count: items.length,
    activeId: docs.activeId,
    items,
  });
}

/**
 * Result envelope for the `document_create` resolver.
 *
 * When `isError` is false and `created` is set, the dispatcher will
 * publish the new DocumentsState back onto the in-loop session row so
 * follow-up tools (`document_go_to_page`, `document_read_page`,
 * `document_search`) in the same turn see the freshly-authored doc.
 */
interface DocumentCreateResolution {
  isError: boolean;
  content: string;
  created?: { documentId: string; documents: DocumentsState };
}

const DOCUMENT_CREATE_MAX_CHARS = 25_000;
const DOCUMENT_CREATE_TITLE_MAX = 80;

/**
 * Resolve a `document_create` tool_use (Phase 6 / Priority 1d).
 *
 * Server-fulfilled write. Steps:
 *   1. Validate `title` + `content` (length caps, non-empty).
 *   2. Allocate a new document id and split the markdown into pages
 *      using the same paginator the markdown extractor uses for
 *      uploads — so AI-authored docs are searchable / indexable via
 *      the exact same pipeline.
 *   3. Persist the per-page text inline (no Storage blob).
 *   4. Embed + index chunks when `VOYAGE_API_KEY` is set, so
 *      `document_search` can find the new doc semantically. Falls
 *      back cleanly when the key is missing.
 *   5. Append a new DocumentRecord to the session's documents JSONB
 *      and make it the active document.
 *
 * Returns a `tool_result` JSON envelope with the new id + page count so
 * Seneca can chain `document_go_to_page` to surface what they wrote.
 */
async function resolveDocumentCreate(
  rawInput: unknown,
  userId: string,
  sessionId: string,
  jwt: string | undefined,
  persistedDocs: DocumentsState,
): Promise<DocumentCreateResolution> {
  const input = (rawInput ?? {}) as {
    title?: unknown;
    content?: unknown;
    format?: unknown;
  };

  const title = typeof input.title === "string" ? input.title.trim() : "";
  const content = typeof input.content === "string" ? input.content : "";
  const format = typeof input.format === "string" ? input.format : "markdown";

  if (!title) {
    return {
      isError: true,
      content: JSON.stringify({
        error: "`title` must be a non-empty string.",
      }),
    };
  }
  if (title.length > DOCUMENT_CREATE_TITLE_MAX) {
    return {
      isError: true,
      content: JSON.stringify({
        error: `\`title\` is too long (${title.length} chars). Cap is ${DOCUMENT_CREATE_TITLE_MAX}.`,
      }),
    };
  }
  if (!content.trim()) {
    return {
      isError: true,
      content: JSON.stringify({
        error: "`content` must be a non-empty markdown string.",
      }),
    };
  }
  if (content.length > DOCUMENT_CREATE_MAX_CHARS) {
    return {
      isError: true,
      content: JSON.stringify({
        error: `\`content\` is too long (${content.length} chars). Cap is ${DOCUMENT_CREATE_MAX_CHARS}.`,
      }),
    };
  }
  if (format !== "markdown") {
    return {
      isError: true,
      content: JSON.stringify({
        error: `Unsupported \`format\` "${format}". Only "markdown" is supported.`,
      }),
    };
  }

  // Reuse the markdown extractor's pageify so AI-authored and uploaded
  // markdown share an indexing pipeline (chunker downstream depends on
  // the same per-page shape).
  const pages = mdInternals.pageify(content);

  const documentId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const filename = `${title.replace(/[\\/:*?"<>|]+/g, "_")}.md`;

  // 1. Inline persistence: write per-page text rows.
  try {
    await documentTextStore.put(userId, sessionId, documentId, pages);
  } catch (err) {
    return {
      isError: true,
      content: JSON.stringify({
        error: `Couldn't persist the document text: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }),
    };
  }

  // 2. Best-effort embedding index. Failure here is fine — search
  //    falls back to substring on this doc, same as a normal upload
  //    whose Voyage call fails.
  let indexStatus: DocumentRecord["indexStatus"] = "skipped";
  let indexedAt: string | null = null;
  if (env.voyageApiKey && pages.some((p) => p.charCount > 0)) {
    try {
      const chunks = chunkPages(pages);
      if (chunks.length > 0) {
        const embeddings = await embed(
          chunks.map((c) => c.text),
          "document",
        );
        const rows = chunks.map((c, i) => ({
          page: c.page,
          chunkIndex: c.chunkIndex,
          text: c.text,
          embedding: embeddings[i]!,
        }));
        await documentChunkStore.put(userId, sessionId, documentId, rows);
        indexStatus = "indexed";
        indexedAt = nowIso;
      }
    } catch (err) {
      if (err instanceof VoyageNotConfiguredError) {
        indexStatus = "skipped";
      } else {
        console.warn(
          "[seneca] document_create indexing failed; search will fall back to substring:",
          err instanceof Error ? err.message : err,
        );
        indexStatus = "failed";
      }
    }
  }

  const newRecord: DocumentRecord = {
    id: documentId,
    name: title,
    filename,
    size: Buffer.byteLength(content, "utf8"),
    pageCount: pages.length,
    currentPage: 1,
    uploadedAt: nowIso,
    textStatus: "extracted",
    extractedAt: nowIso,
    indexStatus,
    indexedAt,
    mime: "text/markdown",
    renderHint: "markdown",
    origin: "ai-created",
  };

  const nextDocs: DocumentsState = {
    items: [...persistedDocs.items, newRecord],
    activeId: documentId,
  };

  try {
    await sessionStore.updateDocuments(sessionId, userId, nextDocs, jwt);
  } catch (err) {
    // Roll back the inline text + chunks so a retry doesn't double-up.
    await documentTextStore
      .delete(userId, sessionId, documentId)
      .catch(() => undefined);
    await documentChunkStore
      .delete(userId, sessionId, documentId)
      .catch(() => undefined);
    return {
      isError: true,
      content: JSON.stringify({
        error: `Couldn't update the session: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }),
    };
  }

  return {
    isError: false,
    content: JSON.stringify({
      documentId,
      documentName: title,
      pageCount: pages.length,
      indexStatus,
      activeId: documentId,
      note: "The new document is now visible in the user's documents sidebar. You can chain `document_go_to_page` to make sure they see it.",
    }),
    created: { documentId, documents: nextDocs },
  };
}

interface DocumentSearchResolution {
  isError: boolean;
  content: string;
}

/**
 * Resolve a `document_search` tool_use.
 *
 * Two-engine design:
 *
 *   1. **Vector path (primary, Priority 1b).** Embed the query via Voyage,
 *      then ask the chunk store for the top-k cosine matches. The store
 *      returns hits with normalised similarity in `[0, 1]`; we carve a
 *      snippet from the chunk text and project to the
 *      `{documentId, documentName, page, snippet, score}` wire shape.
 *
 *   2. **Substring fallback.** If `VOYAGE_API_KEY` is unset, the Voyage
 *      request fails, or the chunk store returns zero hits, we fall
 *      through to a naive case-insensitive substring scan over the
 *      per-page text. Same wire shape; `score` is the raw hit-count on
 *      the page (integer ≥ 1). The tool_result envelope tags which
 *      engine ran so Seneca knows the search wasn't semantic.
 *
 * Documents with no chunks AND no extracted text (legacy uploads,
 * scanned PDFs that never extracted, anything whose extraction failed)
 * are skipped and reported under `skipped` so Seneca can mention it
 * honestly rather than silently miss them.
 */
async function resolveDocumentSearch(
  rawInput: unknown,
  userId: string,
  sessionId: string,
  persistedDocs: DocumentsState,
): Promise<DocumentSearchResolution> {
  const input = (rawInput ?? {}) as {
    query?: unknown;
    top_k?: unknown;
    document_id?: unknown;
  };

  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    return {
      isError: true,
      content: JSON.stringify({
        error: "`query` must be a non-empty string.",
      }),
    };
  }

  const topK = clampTopK(input.top_k);
  const restrictTo =
    typeof input.document_id === "string" && input.document_id.trim()
      ? input.document_id.trim()
      : null;

  const targets = restrictTo
    ? persistedDocs.items.filter((d) => d.id === restrictTo)
    : persistedDocs.items;

  if (targets.length === 0) {
    return {
      isError: false,
      content: JSON.stringify({
        query,
        engine: "none",
        count: 0,
        hits: [],
        searched: 0,
        skipped: [],
        note: restrictTo
          ? `No document with id ${restrictTo} is loaded in this session.`
          : "No documents are loaded in this session. Ask the user to upload one.",
      }),
    };
  }

  // ── 1. Try vector search ────────────────────────────────────────────────
  const indexedDocIds = new Set(
    targets.filter((d) => d.indexStatus === "indexed").map((d) => d.id),
  );

  let vectorHits:
    | Array<{
        documentId: string;
        documentName: string;
        page: number;
        snippet: string;
        score: number;
      }>
    | null = null;
  let vectorError: string | null = null;

  if (env.voyageApiKey && indexedDocIds.size > 0) {
    try {
      const [queryEmbedding] = await embed([query], "query");
      if (queryEmbedding) {
        const rawHits = await documentChunkStore.topK(
          userId,
          sessionId,
          queryEmbedding,
          topK * 2, // over-fetch; we filter to in-scope docs below
          restrictTo ?? undefined,
        );
        const docNameById = new Map(targets.map((d) => [d.id, d.name]));
        vectorHits = rawHits
          .filter((h) => docNameById.has(h.documentId))
          .slice(0, topK)
          .map((h) => ({
            documentId: h.documentId,
            documentName: docNameById.get(h.documentId)!,
            page: h.page,
            snippet: snippetFromChunk(h.text, query),
            score: Number(h.score.toFixed(4)),
          }));
      }
    } catch (err) {
      if (err instanceof VoyageNotConfiguredError) {
        // Not really an error — just a config gap. Fall back silently.
        vectorError = null;
      } else {
        vectorError = err instanceof Error ? err.message : String(err);
        console.warn(
          "[seneca] document_search vector path failed; falling back to substring:",
          vectorError,
        );
      }
    }
  }

  if (vectorHits && vectorHits.length > 0) {
    return {
      isError: false,
      content: JSON.stringify({
        query,
        engine: "vector",
        count: vectorHits.length,
        total_matches: vectorHits.length,
        searched: indexedDocIds.size,
        skipped: targets
          .filter((d) => !indexedDocIds.has(d.id))
          .map((d) => ({
            documentId: d.id,
            documentName: d.name,
            reason:
              d.indexStatus === "indexing"
                ? "Indexing in progress — try again shortly."
                : d.indexStatus === "skipped" || d.indexStatus === "failed"
                  ? "No embeddings available; fell back to substring on this doc only."
                  : "Indexing has not run yet.",
          })),
        hits: vectorHits,
      }),
    };
  }

  // ── 2. Substring fallback ───────────────────────────────────────────────
  const needle = query.toLowerCase();
  const allHits: Array<{
    documentId: string;
    documentName: string;
    page: number;
    snippet: string;
    score: number;
  }> = [];
  const skipped: Array<{ documentId: string; documentName: string; reason: string }> =
    [];
  let searched = 0;

  for (const doc of targets) {
    const pages = await documentTextStore
      .getAll(userId, sessionId, doc.id)
      .catch(() => null);
    if (!pages || pages.length === 0) {
      skipped.push({
        documentId: doc.id,
        documentName: doc.name,
        reason:
          "No extracted text yet — try document_read_page on a page of this doc to trigger lazy extraction.",
      });
      continue;
    }
    searched += 1;

    for (const p of pages) {
      const haystack = p.text.toLowerCase();
      if (!haystack) continue;

      let hits = 0;
      let idx = haystack.indexOf(needle);
      const firstIdx = idx;
      while (idx >= 0) {
        hits += 1;
        idx = haystack.indexOf(needle, idx + needle.length);
      }
      if (hits === 0 || firstIdx < 0) continue;

      const ctxRadius = 150;
      const start = Math.max(0, firstIdx - ctxRadius);
      const end = Math.min(p.text.length, firstIdx + needle.length + ctxRadius);
      let snippet = p.text.slice(start, end).replace(/\s+/g, " ").trim();
      if (start > 0) snippet = "…" + snippet;
      if (end < p.text.length) snippet = snippet + "…";

      allHits.push({
        documentId: doc.id,
        documentName: doc.name,
        page: p.page,
        snippet,
        score: hits,
      });
    }
  }

  allHits.sort((a, b) => b.score - a.score || a.page - b.page);
  const hits = allHits.slice(0, topK);

  return {
    isError: false,
    content: JSON.stringify({
      query,
      engine: "substring",
      vector_error: vectorError,
      count: hits.length,
      total_matches: allHits.length,
      searched,
      skipped,
      hits,
    }),
  };
}

/**
 * Carve a ~300-char window around the first occurrence of the query (if
 * present) so the snippet always shows the user something relevant.
 * Falls back to the chunk's leading text when the query doesn't appear
 * literally — vector matches often hit on paraphrase.
 */
function snippetFromChunk(chunkText: string, query: string): string {
  const lower = chunkText.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) {
    const head = chunkText.slice(0, 300).trim();
    return head + (chunkText.length > 300 ? "…" : "");
  }
  const ctxRadius = 150;
  const start = Math.max(0, idx - ctxRadius);
  const end = Math.min(chunkText.length, idx + query.length + ctxRadius);
  let snippet = chunkText.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < chunkText.length) snippet = snippet + "…";
  return snippet;
}

function clampTopK(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 5;
  if (n < 1) return 1;
  if (n > 20) return 20;
  return Math.floor(n);
}

async function appendAssistantTurn(
  sessionId: string,
  userId: string,
  jwt: string | undefined,
  priorTranscript: TranscriptMessage[],
  text: string,
  turnId: string,
  hadVision: boolean,
  toolCalls: import("@seneca/shared").ToolCallRecord[],
): Promise<void> {
  // Only skip persistence when the model produced NEITHER text NOR a
  // tool_use. If it emitted tools but no text (e.g. silent multi-tool
  // sequence), we still want the tool_use blocks on the transcript so
  // the next turn's `buildAnthropicMessages` can echo them back to
  // Claude — orphaning them would re-trigger tech-debt #1.
  if (!text.trim() && toolCalls.length === 0) return;
  const newMessage: TranscriptMessage = {
    id: turnId,
    role: "seneca",
    text,
    ts: new Date().toISOString(),
    hadVision: hadVision || undefined,
    tools: toolCalls.length > 0 ? toolCalls : undefined,
  };
  const updatedTranscript: TranscriptMessage[] = [
    ...priorTranscript,
    newMessage,
  ];
  await sessionStore.updateTranscript(sessionId, userId, updatedTranscript, jwt);
}

/**
 * Phase 4: bump the per-session rolling usage totals after a turn
 * completes. Best-effort — telemetry never blocks user-visible output,
 * so we log and swallow on failure.
 */
async function accumulateSessionUsage(
  sessionId: string,
  userId: string,
  jwt: string | undefined,
  turnUsage: ClaudeTurnUsage,
  cost: { inputCostUSD: number; outputCostUSD: number },
): Promise<void> {
  try {
    await sessionStore.bumpUsage(sessionId, userId, jwt, {
      inputTokens: turnUsage.input_tokens,
      outputTokens: turnUsage.output_tokens,
      cacheReadInputTokens: turnUsage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: turnUsage.cache_creation_input_tokens ?? 0,
      inputCostUSD: cost.inputCostUSD,
      outputCostUSD: cost.outputCostUSD,
    });
  } catch (err) {
    console.warn(
      "[seneca] failed to bump session usage",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Pure helpers exposed for unit tests. Re-exporting via a single
 * `_internals` namespace keeps the file's public surface small while
 * letting tests reach the file-private logic that does most of the
 * work (clamps, the agent-loop message builder, the resolvers).
 */
export const _internals = {
  buildAnthropicMessages,
  buildSystemPrompt,
  clampPage,
  clampMaxChars,
  clampTopK,
  resolveDocumentList,
  resolveDocumentSearch,
  resolveDocumentReadPage,
  resolveDocumentCreate,
};
