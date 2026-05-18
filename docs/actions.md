# Seneca — Action / Tool-Use Protocol

How Seneca takes action on the shared canvas. We use **Anthropic's tool-use API** rather than embedded XML tags in the response text (decision per vision §11.1).

## Why tool-use

- Schema-validated by the model: invalid actions never reach the client.
- Streaming-friendly: `tool_use` blocks arrive as discrete `content_block_*` SSE events.
- Multi-step actions (e.g. clear-then-draw-several-shapes) are handled cleanly via a server-side agent loop.

## Agent loop

A single `/api/chat` or `/api/vision` request runs a **server-side agent loop**. The server keeps calling Claude until `stop_reason !== "tool_use"`. Server-fulfilled tools (`web_read_page`, `document_read_page`, `document_list`, `document_search`, `document_create`) resolve inline and their *real* `tool_result` is fed back into the next iteration. Client-fulfilled tools get a synthetic `tool_result: "ok"` between iterations so Claude can continue within a turn; if any of them actually failed on the client, the real failure string is queued on the client's `pendingToolResults` and drained onto the *next* user turn's `ChatRequest` — `buildAnthropicMessages` then re-emits the persisted assistant `tool_use` blocks and synthesises matching `tool_result` blocks so Seneca can react. Phase 3 closed the original "tool failures vanish across turns" gap.

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
       ├──→ whiteboard_clear         → excalidrawAPI.updateScene({ elements: [] })
       │     (on success / failure, push to useSenecaStore.pendingToolResults)
       └──→ (server-fulfilled tools are no-ops on the client)

   Next user turn
       client → ChatRequest.toolResults = drainToolResults()
       server → buildAnthropicMessages re-emits prior tool_use blocks +
                synthesises matching tool_result blocks from toolResults
                so Seneca sees the real outcomes from the previous turn.
```

### Cross-turn `tool_result` round-trip (Phase 3)

Phase 3 closed the long-standing "tool failures vanish across turns" gap.

- **Within a turn**, the server emits a synthetic `tool_result: "ok"` for any client-fulfilled tool so Claude can chain multiple tool calls in one iteration without waiting for the client. Server-fulfilled tools resolve inline and feed the real result back instead.
- **At turn end**, the server persists every `tool_use` Claude emitted onto the assistant `TranscriptMessage.tools` (each row is a `ToolCallRecord` with `{ id, name, input, ok?, error? }`). The client dispatcher updates the same record with the real outcome (`ok: true | false`, `error?`) and enqueues a matching `ToolResult` onto `useSenecaStore.pendingToolResults`.
- **On the next user turn**, the client drains that queue into `ChatRequest.toolResults`. `buildAnthropicMessages` walks the persisted assistant turns, re-emits their `tool_use` blocks, and synthesises matching `tool_result` blocks from the queue. Anthropic accepts them because every `tool_use_id` resolves to a still-attached `tool_use`.

Net effect: a real failure string (`"document_go_to_page: no documents loaded"`) reaches Seneca on the next turn, exactly the round-trip vision §8.8 called for.

## Tools available in this slice

All tools live in [`packages/shared/src/tools.ts`](../packages/shared/src/tools.ts). The MVP set is complete: whiteboard, map, web, documents (read / list / search / go-to-page / create), and the cross-cutting server-fulfilled helpers.

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

### `map_fly_to`

Animate the camera to a coordinate. If `label` is set, a pin is also dropped at the destination.

```json
{
  "name": "map_fly_to",
  "input": {
    "lat": number,        // -90..90
    "lng": number,        // -180..180
    "zoom": number,       // optional, 0..19; defaults to current
    "label": string       // optional; presence drops a labelled pin
  }
}
```

### `map_drop_pin`

Place a labelled pin without changing the camera. The label is shown as a permanent tooltip above the marker.

```json
{
  "name": "map_drop_pin",
  "input": {
    "lat": number,
    "lng": number,
    "label": string       // required, non-empty
  }
}
```

### `map_draw_shape`

Add a polyline (path) or polygon (region) to the map's feature group. Points are `[lat, lng]` pairs in order. Polylines need ≥ 2 points; polygons need ≥ 3.

```json
{
  "name": "map_draw_shape",
  "input": {
    "type": "polyline" | "polygon",
    "points": [[lat, lng], ...],
    "label": string,      // optional, shown on hover
    "color": string       // optional CSS colour; defaults to a brand red
  }
}
```

### `map_set_layer`

Switch the base tile layer. `standard` is OpenStreetMap; `satellite` is Esri World Imagery.

```json
{
  "name": "map_set_layer",
  "input": {
    "layer": "standard" | "satellite"
  }
}
```

**Implementation note:** the dispatcher pulses the map tab before each `map_*` call (`setActiveTab("map", { pulse: true })`) so the user sees the switch happen even if they were on a different tab. See [`apps/web/src/lib/actionDispatcher.ts`](../apps/web/src/lib/actionDispatcher.ts).

### `web_navigate`

Load a URL through the sanitised proxy. The proxy refuses anything that isn't `http(s)` and any host that resolves to a private / loopback / link-local IP.

```json
{
  "name": "web_navigate",
  "input": {
    "url": "https://en.wikipedia.org/wiki/Baruch_Spinoza"
  }
}
```

The dispatcher `await`s the proxy fetch, so the chip turns green only once the iframe has the new HTML. Failures (bad scheme, SSRF block, timeout, non-HTML, oversize) bubble back as a red chip with the proxy's friendly message.

### `web_search`

Search the web via Tavily. Returns a clickable card list overlaid on the page area; the user (or a follow-up Seneca turn) navigates to a result.

```json
{
  "name": "web_search",
  "input": {
    "query": "Spinoza portrait",
    "max_results": 5
  }
}
```

`max_results` defaults to 5, capped at 10. If `TAVILY_API_KEY` is unset on the server the route returns 503 and the chip explains how to fix it (see [`docs/setup.md`](setup.md) §2.5).

### `web_read_page`

Read the *text* of a page so Seneca can answer questions about its content without burning a vision turn. Cheaper than the eye-toggle pipeline because we feed plain text (sanitised → tag-stripped) into the model instead of a base64 PNG and a vision-grade model.

```json
{
  "name": "web_read_page",
  "input": {
    "url": "https://en.wikipedia.org/wiki/Baruch_Spinoza",  // optional
    "max_chars": 12000                                       // optional, 500–30000
  }
}
```

When `url` is omitted the server reads whichever page is currently loaded. The "currently loaded" URL is the most recent `web_navigate` *within this turn* (so navigate-then-read chains naturally), falling back to the persisted session URL.

**Implementation notes:**
- Sanitisation strips every `<script>`, `on*` attribute, `<iframe>`, `<object>`, `<form>`, and `<meta http-equiv>`. Inline `style` is kept for visual fidelity. Anchor tags are forced to `target="_blank" rel="noopener noreferrer"`. See [`apps/api/src/lib/webProxy.ts`](../apps/api/src/lib/webProxy.ts).
- Vision capture snapshots the iframe's `contentDocument.documentElement` via `html-to-image`. Falls back to the host wrapper if the iframe content taints the canvas.
- Persistence stores `url` + `history` only. The HTML refetches on reload.

> **Phase 5 — multi-format support.** Document uploads now go through an
> extractor registry in [`apps/api/src/lib/documentExtractors/`](../apps/api/src/lib/documentExtractors/).
> Supported types: PDF, `.docx` (converted to markdown via `mammoth`),
> `.pptx` (one slide → one page via `jszip`), `.md` / `.markdown` / `.txt`,
> `.html` / `.htm` (sanitised text). Each extractor declares a
> `renderHint` (`pdfjs` / `markdown` / `html`) that the client's
> `DocumentTab` switches on: PDFs go through `react-pdf` as before; every
> other format renders through a themed markdown viewer. The four
> document tools (`document_go_to_page`, `document_read_page`,
> `document_list`, `document_search`) work identically across formats —
> they operate on the per-page extracted text, so a query against a
> mixed-format session lands hits across PDF, Word, and slides without
> any per-format branching.

### `document_go_to_page`

Navigate the documents tab to a specific page. Pages are 1-indexed; values past the document length are clamped to the last page.

```json
{
  "name": "document_go_to_page",
  "input": {
    "page": 12,
    "document_id": "uuid"   // optional; defaults to active document
  }
}
```

**Implementation notes:**
- The dispatcher pulses the documents tab before applying the call (`setActiveTab("documents", { pulse: true })`).
- When `document_id` refers to a document that's still loading, the page change is queued in `pendingPageRef` and applied once `<Document>`'s `onLoadSuccess` fires with the real page count.
- Throws when no documents are loaded — the chip turns red with a message Seneca can address on the next turn ("the user needs to upload a PDF first").
- See [`apps/web/src/lib/documentActions.ts`](../apps/web/src/lib/documentActions.ts) and [`apps/web/src/components/Canvas/DocumentTab.tsx`](../apps/web/src/components/Canvas/DocumentTab.tsx).

### `document_read_page`

Read the *text* of a specific page in an uploaded PDF without burning a vision turn. For born-digital PDFs this returns clean plain text (extracted by `pdfjs-dist` server-side at upload). For scanned PDFs (where the page is really an image) the server quietly rasterises the page and returns it as a multimodal `tool_result` image — Seneca reads it visually in the same iteration, and the user never has to enable vision capture.

```json
{
  "name": "document_read_page",
  "input": {
    "page": 12,
    "document_id": "uuid",  // optional; defaults to active document
    "max_chars": 12000      // optional, 500–30000
  }
}
```

**Implementation notes:**
- Server-fulfilled. The agent loop in [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) resolves the doc id (explicit → in-turn active → persisted active), pulls the page from [`apps/api/src/lib/documentTextStore.ts`](../apps/api/src/lib/documentTextStore.ts), and returns a JSON envelope `{ documentId, documentName, page, pageCount, charCount, truncated, max_chars, text }` as the `tool_result` content.
- **Scanned-PDF fallback.** When the page's `char_count` falls below `SCANNED_PAGE_CHARS_THRESHOLD` (see [`apps/api/src/lib/pdfTextExtractor.ts`](../apps/api/src/lib/pdfTextExtractor.ts)), the resolver renders the page server-side via [`apps/api/src/lib/pdfPageRenderer.ts`](../apps/api/src/lib/pdfPageRenderer.ts) (`pdfjs-dist` + `@napi-rs/canvas`) and returns a *multimodal* tool_result `[{type:"text", text:"..."}, {type:"image", source:{type:"base64", media_type:"image/png", data:"..."}}]`. The client still receives the action SSE event so the chip appears; the dispatcher is a no-op for this tool.
- **Lazy extraction.** If no text rows exist for the doc (legacy uploads from before Priority 1a, or a record where upload-time extraction failed), the resolver fetches the bytes via the document store, runs extraction on demand, persists the result, and proceeds. First-read latency on legacy docs reflects this.
- **In-turn active doc tracking.** A `document_go_to_page` call within the same agent loop iteration updates the loop's `activeDocumentId`, so a chained `document_read_page` without an explicit `document_id` targets the doc Claude just switched to. Same pattern as `web_navigate` → `web_read_page`.
- **Pair with `document_go_to_page`.** The natural chain is `document_go_to_page(page)` → `document_read_page(page)` in the same turn: the user sees the page land in front of them while Seneca reads it.

### `document_list`

Project the session's loaded documents into a `tool_result` so Seneca knows what is in the user's sidebar. Zero-arg, server-fulfilled, no IO.

```json
{
  "name": "document_list",
  "input": {}
}
```

The `tool_result` envelope is:

```json
{
  "count": 2,
  "activeId": "uuid-or-null",
  "items": [
    {
      "id": "uuid",
      "name": "Spinoza Letters",
      "filename": "spinoza-letters.pdf",
      "pageCount": 240,
      "currentPage": 12,
      "textStatus": "extracted",
      "active": true
    }
  ]
}
```

**Implementation notes:**
- Server-fulfilled. Resolver lives in `resolveDocumentList` inside [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts).
- Pure read against `sessionRow.documents` — no documentStore or text-store calls. Constant-time regardless of doc count.
- The system prompt instructs Seneca to call this whenever the user asks what they've uploaded, or when Seneca needs to choose between multiple documents.

### `document_search`

Search across every extracted page in the session for a query phrase and return the top ranked hits with snippets. Closes the obvious gap where Seneca knew a document existed but couldn't find phrases inside it.

```json
{
  "name": "document_search",
  "input": {
    "query": "TS/SCI clearance",
    "top_k": 5,            // optional, 1–20, defaults to 5
    "document_id": "uuid"  // optional, restricts the search to one doc
  }
}
```

`tool_result` envelope:

```json
{
  "query": "TS/SCI clearance",
  "engine": "vector",
  "count": 3,
  "total_matches": 3,
  "searched": 2,
  "skipped": [
    {
      "documentId": "uuid",
      "documentName": "Scan",
      "reason": "No embeddings available; fell back to substring on this doc only."
    }
  ],
  "hits": [
    {
      "documentId": "uuid",
      "documentName": "Spinoza Letters",
      "page": 47,
      "snippet": "…the position requires an active TS/SCI clearance and…",
      "score": 0.86
    }
  ]
}
```

**Implementation notes:**

- Server-fulfilled. Resolver lives in `resolveDocumentSearch` inside [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts).
- **Two engines, one wire shape.** The `engine` field tells you which path produced the results:
  - `"vector"` — Voyage AI embedded the query, `pgvector` (or the in-memory cosine pass in dev-bypass) ranked the chunks. `score` is a normalised cosine similarity in `[0, 1]` — 1 = same direction, 0 = orthogonal / opposite. **Primary path** when `VOYAGE_API_KEY` is set and at least one doc has `indexStatus: "indexed"`.
  - `"substring"` — naive case-insensitive `String.prototype.indexOf` over the per-page text in [`apps/api/src/lib/documentTextStore.ts`](../apps/api/src/lib/documentTextStore.ts). `score` is the raw hit-count on the page; ties break by ascending page. **Fallback** when Voyage is unconfigured, throws, or returns zero hits — and the *only* engine that ever runs on non-indexed docs (e.g. scanned PDFs).
  - `"none"` — there are no docs in scope at all (empty session, or `document_id` referred to an unknown doc).
- **Snippet is ±150 chars** around the first literal-query occurrence (or the chunk's leading text if the match was purely semantic and the query doesn't appear verbatim).
- **Indexing happens at upload time** (synchronous), driven by [`apps/api/src/lib/pdfChunker.ts`](../apps/api/src/lib/pdfChunker.ts) (~500-token windows, ~50-token overlap, page-aware) + [`apps/api/src/lib/voyageEmbeddings.ts`](../apps/api/src/lib/voyageEmbeddings.ts) + [`apps/api/src/lib/documentChunkStore.ts`](../apps/api/src/lib/documentChunkStore.ts). Status is surfaced on `DocumentRecord.indexStatus` and pilled in the sidebar.
- **No lazy extraction or lazy indexing.** Search deliberately skips docs without extracted text (rather than running extraction inline). The `skipped` list tells Seneca how to recover — usually a `document_read_page` on one page triggers lazy extraction for that doc, after which a subsequent search will include it on the substring path.
- **Restrict via `document_id`.** When set and the id is unknown, the resolver returns a clean `count: 0` envelope with a note rather than erroring — Claude has the option to retry without the filter.
- **Graceful degradation is the rule, not the exception.** A Voyage outage drops to substring; a missing `pgvector` extension drops to substring; a scanned PDF stays on substring forever. Search never hard-errors on infra problems.

#### Server-fulfilled tools

Most of our tools are *client-fulfilled*: Claude emits a `tool_use`, the SSE stream forwards it to the client, the dispatcher mutates the canvas, the server's synthetic `tool_result: "ok"` keeps Claude moving *within* the turn, and the real outcome (`ok: true | false`, optional `error`) is queued on `useSenecaStore.pendingToolResults` and reported back to Seneca on the next user turn (see "Cross-turn `tool_result` round-trip" above). The chip strip surfaces the outcome to the user immediately; cross-turn reporting surfaces it to Seneca.

### `document_create`

AI-authored markdown documents. The new doc appears in the user's sidebar with a small "✦" badge so it's clear Seneca wrote it, not the user. The bytes live inline in `document_pages` — no Storage blob — and the doc is immediately searchable via `document_search` (cosine when `VOYAGE_API_KEY` is set, substring fallback otherwise).

```json
{
  "name": "document_create",
  "input": {
    "title": "Stoicism — one-page summary",
    "content": "# Stoicism\n\nA practical philosophy...",
    "format": "markdown"     // optional, "markdown" is the only value today
  }
}
```

The `tool_result` envelope is:

```json
{
  "documentId": "uuid",
  "documentName": "Stoicism — one-page summary",
  "pageCount": 1,
  "indexStatus": "indexed",
  "activeId": "uuid",
  "note": "The new document is now visible in the user's documents sidebar..."
}
```

**Implementation notes:**
- Server-fulfilled. Resolver lives in `resolveDocumentCreate` inside [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts).
- Caps: title 80 chars, content 25,000 chars. The resolver validates both and returns an `is_error: true` envelope if they're out of range.
- Page-splits via the same `pageify` heuristic the markdown extractor uses on uploads — headings first, length next — so AI-authored and uploaded markdown share an indexing pipeline.
- Persists inline through `documentTextStore.put`; embeds + indexes via Voyage when configured. Failure to index drops to `skipped` / `failed` so search keeps working via the substring fallback.
- Emits a `documents-updated` SSE event with the fresh `DocumentsState` so the client sidebar updates mid-turn instead of waiting for the next session reload.
- The resolver mutates the in-loop `sessionRow.documents` and `activeDocumentId`, so a chained `document_go_to_page` later in the same turn lands the user on the freshly-authored doc.
- `DocumentRecord.origin` is set to `"ai-created"` so the sidebar can badge it.

`web_read_page`, `document_read_page`, `document_list`, `document_search`, and `document_create` are *server-fulfilled* — the agent loop in [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) detects the tool name, runs the resolver inline (`fetchAndSanitise` + `extractTextFromHtml` for the web tool; `documentTextStore.getPage` plus optional `renderPdfPageToPng` for the document read; a pure projection of `sessionRow.documents` for `document_list`; cosine top-k via Voyage + pgvector for `document_search`, with substring fallback; pageify + persist + index + emit-SSE for `document_create`), and feeds the real content back as the `tool_result` content. The client still receives the action SSE event so the chip appears, but the dispatcher is a no-op for these tools (see [`apps/web/src/lib/actionDispatcher.ts`](../apps/web/src/lib/actionDispatcher.ts)).

Notably, `document_read_page` is the first tool whose `tool_result` content is *multimodal* — when text extraction fails it returns an array of `[text, image]` blocks instead of a string. The agent-loop types in `chat.ts` (`AnthropicToolResultContent`) accept either shape.

When you add another server-fulfilled tool, follow the same pattern: branch in the `Promise.all(toolUses.map(...))` block in `chat.ts`, return the real content; add a no-op chip branch in the dispatcher; document the tool here.

## Adding new actions

1. Add the schema to `packages/shared/src/tools.ts` (one `const` per tool) and include it in `ALL_TOOLS`.
2. Add the dispatcher case in `apps/web/src/lib/actionDispatcher.ts`.
3. Add a presenter entry in `apps/web/src/lib/toolSummary.ts` so the chip shows a friendly summary.
4. If the tool targets a non-active tab, call `useSenecaStore.getState().setActiveTab(targetTab, { pulse: true })` in the dispatcher so the UI surfaces the switch.
5. Document the schema here.

## What the client persists per turn

When a turn commits, every emitted tool call is attached to the resulting Seneca `TranscriptMessage` as `tools: ToolCallRecord[]`. Each record has `{ id, name, input, ok?, error? }`. The chip strip below the bubble reads from this.

Phase 3 closed the original "chips disappear on reload" gap. `TranscriptMessage.tools` is now persisted server-side (Postgres in real-auth, the in-memory map in dev-bypass) and rehydrated on session load, so reloading the page or switching sessions preserves every chip — and `buildAnthropicMessages` re-emits the underlying `tool_use` blocks so the cross-turn round-trip described above stays correct.
