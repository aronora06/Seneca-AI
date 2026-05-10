import { Router, type Response } from "express";
import type {
  ChatRequest,
  TranscriptMessage,
  ToolResult,
} from "@seneca/shared";
import { ALL_TOOLS, SENECA_SYSTEM_PROMPT } from "@seneca/shared";

import { anthropic, ANTHROPIC_MAX_TOKENS } from "../lib/anthropic.js";
import { openSseStream } from "../lib/sse.js";
import { sessionStore } from "../lib/sessionStore.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { env } from "../env.js";

export const chatRouter = Router();

chatRouter.post("/api/chat", requireAuth, (req, res) => {
  void handleTurn(req as AuthedRequest, res, { withVision: false });
});

chatRouter.post("/api/vision", requireAuth, (req, res) => {
  void handleTurn(req as AuthedRequest, res, { withVision: true });
});

interface HandlerOptions {
  withVision: boolean;
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
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  is_error?: boolean;
  content: string;
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

  // Confirm the session belongs to this user before any expensive work.
  let sessionRow: { id: string } | null;
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

  const { send, close } = openSseStream(res);

  const turnId = crypto.randomUUID();
  let fullTextAcrossLoop = "";
  const controller = new AbortController();

  req.on("close", () => {
    controller.abort();
  });

  try {
    const model = opts.withVision
      ? env.anthropicVisionModel
      : env.anthropicTextModel;

    for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++) {
      const { textInThisTurn, assistantContent, stopReason } =
        await runOneClaudeTurn(model, messages, send, controller.signal);

      fullTextAcrossLoop += textInThisTurn;

      if (stopReason !== "tool_use") {
        break;
      }

      // Append the assistant's full content (text + tool_use blocks) and a
      // synthetic tool_result message so Claude can keep going. Real tool
      // execution happens on the client; if it fails the error will be
      // attached to the *next* user turn via body.toolResults.
      messages.push({ role: "assistant", content: assistantContent });

      const toolUseIds = assistantContent
        .filter((b): b is AnthropicToolUseBlock => b.type === "tool_use")
        .map((b) => b.id);

      messages.push({
        role: "user",
        content: toolUseIds.map<AnthropicToolResultBlock>((id) => ({
          type: "tool_result",
          tool_use_id: id,
          is_error: false,
          content: "ok",
        })),
      });
    }

    await appendAssistantTurn(
      body.sessionId,
      req.user.id,
      req.jwt,
      body.messages,
      fullTextAcrossLoop,
      turnId,
      opts.withVision,
    );

    send({ type: "done", turnId, fullText: fullTextAcrossLoop });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: "error", message: msg });
  } finally {
    close();
  }
}

interface ClaudeTurnResult {
  textInThisTurn: string;
  assistantContent: AnthropicContent[];
  stopReason: string | null | undefined;
}

/**
 * Runs a single Claude streaming call. Streams text deltas and emits an
 * `action` SSE event for each completed tool_use block. Returns the
 * assembled assistant content so the caller can append it back into the
 * message history for the next iteration.
 */
async function runOneClaudeTurn(
  model: string,
  messages: AnthropicMessage[],
  send: (e: import("@seneca/shared").ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<ClaudeTurnResult> {
  const stream = anthropic.messages.stream(
    {
      model,
      system: SENECA_SYSTEM_PROMPT,
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
  return {
    textInThisTurn,
    assistantContent: finalMessage.content as unknown as AnthropicContent[],
    stopReason: finalMessage.stop_reason,
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
  for (let i = 0; i < visible.length; i++) {
    const msg = visible[i]!;
    const isLast = i === visible.length - 1;

    if (msg.role === "user") {
      const content: AnthropicContent[] = [];

      if (isLast && toolResults.length > 0) {
        for (const tr of toolResults) {
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
      out.push({
        role: "assistant",
        content: [{ type: "text", text: msg.text }],
      });
    }
  }

  return out;
}

async function appendAssistantTurn(
  sessionId: string,
  userId: string,
  jwt: string | undefined,
  priorTranscript: TranscriptMessage[],
  text: string,
  turnId: string,
  hadVision: boolean,
): Promise<void> {
  if (!text.trim()) return;
  const newMessage: TranscriptMessage = {
    id: turnId,
    role: "seneca",
    text,
    ts: new Date().toISOString(),
    hadVision: hadVision || undefined,
  };
  const updatedTranscript: TranscriptMessage[] = [
    ...priorTranscript,
    newMessage,
  ];
  await sessionStore.updateTranscript(sessionId, userId, updatedTranscript, jwt);
}
