# Seneca — Action / Tool-Use Protocol

How Seneca takes action on the shared canvas. We use **Anthropic's tool-use API** rather than embedded XML tags in the response text (decision per vision §11.1).

## Why tool-use

- Schema-validated by the model: invalid actions never reach the client.
- Streaming-friendly: `tool_use` blocks arrive as discrete `content_block_*` SSE events.
- Multi-step actions (e.g. clear-then-draw-several-shapes) are handled cleanly via a server-side agent loop.

## Agent loop

A single `/api/chat` or `/api/vision` request runs a **server-side agent loop**. The server keeps calling Claude until `stop_reason !== "tool_use"`, attaching synthetic `tool_result: "ok"` blocks between iterations so Claude can continue. The client dispatches each `tool_use` on the canvas as the actions stream in, but **does not** send tool results back over the wire.

```
┌───────────────┐
│   /api/chat   │ POST messages
│  /api/vision  │
└──────┬────────┘
       │
       ▼
   server agent loop  ──┐
       │                │
       │   iter N:      │
       │   claude.messages.stream(...)
       │   ↓ text deltas  ──→ SSE { type: "text" }
       │   ↓ tool_use     ──→ SSE { type: "action", call: { id, name, input } }
       │   ↓ stop_reason  ──→ if "tool_use":
       │                       append assistant turn + synthetic tool_result
       │                       loop
       │                     else: break
       │                │
       │   SSE { type: "done", fullText }
       └────────────────┘

   Frontend ActionDispatcher (per action event)
       ├──→ whiteboard_add_element  → excalidrawAPI.updateScene(...)
       └──→ whiteboard_clear         → excalidrawAPI.updateScene({ elements: [] })
```

### Why the client doesn't return tool_results across turns

The previous design (and §8.8 of the vision doc) called for the client to forward `tool_result` blocks on the **next** user turn so failed actions could be reported back to Seneca. We attempted this and hit Anthropic's `unexpected tool_use_id in tool_result blocks` error: the transcript we send back is text-only (we don't persist `tool_use` blocks in `TranscriptMessage`), so the `tool_use_id`s the client knows about are orphans from Claude's perspective.

Until we extend the persisted transcript schema to carry tool_use blocks structurally, the loop is intentionally one-sided:

- Within a turn, the server's synthetic `tool_result: "ok"` keeps Claude moving.
- After a turn, the client retains a tools-array on the assistant `TranscriptMessage` for display. Failures show as red chips.
- If a tool genuinely failed and matters to the conversation, the user can type "the last tool failed because X" — that text is enough context for Seneca.

This is tracked as a deferred item in [docs/handoff.md](handoff.md).

## Tools available in this slice

All tools live in [`packages/shared/src/tools.ts`](../packages/shared/src/tools.ts). Phase 2 ships only the whiteboard set; map / document / web / tab tools land in Phase 3.

> **Naming note:** Anthropic's tool names must match `^[a-zA-Z0-9_-]{1,128}$`, so dots aren't allowed. The vision doc's namespaced form (`whiteboard.add_element`) is rendered as `whiteboard_add_element` on the wire. The split is purely cosmetic.

### `whiteboard_add_element`

Add one element to the shared Excalidraw scene. Coordinates are in scene units (origin top-left of the viewport when freshly cleared, +x right, +y down). Sizes are pixels.

```json
{
  "name": "whiteboard_add_element",
  "input": {
    "type": "text" | "rectangle" | "ellipse" | "line" | "arrow" | "freedraw",
    "x": number,
    "y": number,
    "text": string,                    // required when type === "text"
    "width": number,                   // for rectangle / ellipse (default 120)
    "height": number,                  // for rectangle / ellipse (default 80)
    "points": [[number, number], ...], // for line / arrow / freedraw, relative to (x, y); first point should be [0, 0]
    "strokeColor": "#1e1e1e",          // optional, default Excalidraw black
    "fontSize": 20                     // optional, default for text
  }
}
```

**Implementation note:** Excalidraw's `freedraw` element requires pressure data and other internal fields we can't synthesise. When Seneca emits `freedraw`, we render it as a multi-point `line` — visually identical for sketchy diagrams. See [`apps/web/src/lib/whiteboardActions.ts`](../apps/web/src/lib/whiteboardActions.ts).

### `whiteboard_clear`

Clear every element from the whiteboard.

```json
{
  "name": "whiteboard_clear",
  "input": {}
}
```

## Adding new actions

1. Add the schema to `packages/shared/src/tools.ts` (one `const` per tool) and include it in `ALL_TOOLS`.
2. Add the dispatcher case in `apps/web/src/lib/actionDispatcher.ts`.
3. Add a presenter entry in `apps/web/src/lib/toolSummary.ts` so the chip shows a friendly summary.
4. If the tool targets a non-active tab, call `useSenecaStore.getState().setActiveTab(targetTab, { pulse: true })` in the dispatcher so the UI surfaces the switch.
5. Document the schema here.

## What the client persists per turn

When a turn commits, every emitted tool call is attached to the resulting Seneca `TranscriptMessage` as `tools: ToolCallRecord[]`. Each record has `{ id, name, input, ok?, error? }`. The chip strip below the bubble reads from this.

This is **local UI state only** — the server's session-store persistence only includes text. If you reload the page in real-auth mode, tool chips on past Seneca turns will disappear because they're not in Postgres yet. (See handoff doc — deferred work.)
