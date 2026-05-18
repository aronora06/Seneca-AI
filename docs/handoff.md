# Seneca — Handoff Brief

This document is the single artifact a new agent should read to take over the project. It captures:

1. The product context and committed working agreement.
2. A code-review summary of what exists today.
3. Status tracking against the vision doc's MVP acceptance criteria (§8) and open questions (§11).
4. A prioritised next-steps backlog with concrete entry points.
5. Gotchas and load-bearing decisions the next agent should not undo without thinking.

The product spec is [vision.md](vision.md). Read that first; it is intentionally not edited as the project evolves.

---

## 1. Context

**Seneca** is a voice-driven AI interlocutor with a shared interactive canvas. The user talks to Seneca; Seneca responds in voice and can both *see* and *act on* the canvas. The core thesis (vision §2) is that current chat tools force users to choose between voice and visuals — Seneca lets you do both at once.

The application *is* the agent — never refer to "a chat assistant inside Seneca." Seneca is a singular named interlocutor in the spirit of Lucius Annaeus Seneca the Younger. The system prompt in [`packages/shared/src/prompt.ts`](../packages/shared/src/prompt.ts) is the single source of truth for his voice.

### Working agreement

From vision §0, in priority order:

1. **Decisions in vision §5 (tech stack) are committed.** If a choice blocks you, surface the trade-off; do not quietly substitute.
2. **MVP first, ruthlessly.** Anything not in §7 is out.
3. **Minimal from-scratch engineering.** Wrap battle-tested libraries (Excalidraw, Leaflet, PDF.js, CodeMirror). Don't write a custom whiteboard, map, or PDF engine.
4. **Mobile-aware, desktop-first.** Don't optimise for mobile yet but don't adopt libraries that have no mobile path.
5. **Voice + vision is the differentiator.** When in doubt, invest there.
6. **Build in vertical slices.** Don't build all the canvas tabs before the voice loop works.
7. **Acceptance criteria are testable.** A feature is not done until every checkbox in §8 passes.

### Audience

The user driving this project has limited dev experience. **Be clear and explicit about every action they need to take** — terminal commands, dashboard clicks, file paths. Don't assume familiarity. The user rules in their Cursor config make this explicit; honour them.

---

## 2. Code-review summary

### Layout

```
apps/
  web/              React 18 + Vite + TS + Tailwind + Zustand
    src/
      auth/         AuthProvider, LoginPage
      components/   AppShell, ErrorBoundary, Canvas/*, VoicePane/*
      hooks/        useSpeechRecognition, useSpeechSynthesis
      lib/          api, runTurn, actionDispatcher, captureCanvas, whiteboard*
      store/        seneca.ts (Zustand)
      theme/        ThemeProvider, ThemeToggle
  api/              Node + Express + TS
    src/
      lib/          anthropic, supabase, sessionStore (abstraction), sse
      middleware/   auth
      routes/       chat, sessions, health
      server.ts, env.ts, bootstrap.ts
packages/
  shared/           types, prompt, tools
```

~5.7k LoC across 64 source files. No TODOs / FIXMEs in code.

### Architecture in one diagram

```
Browser
┌───────────────────────────────────────────────────────────────┐
│  ThemeProvider                                                 │
│  └─ AuthProvider (or dev-bypass)                              │
│     └─ ErrorBoundary                                           │
│        └─ AppShell                                             │
│           ├─ VoicePane (STT/TTS, transcript, 👁, chips)       │
│           │   uses useSenecaStore  ←──┐                       │
│           └─ CanvasContainer            │                      │
│              ├─ WhiteboardTab (Excalidraw, refs only)          │
│              ├─ MapTab        (Leaflet + leaflet-draw)         │
│              ├─ WebTab        (sanitised iframe + search)      │
│              └─ DocumentTab   (react-pdf + sidebar)            │
│                each tab → bridge → setXxxApi → dispatcher      │
└───────────────────────┬─────────────────┘                      │
                        │ runTurn → POST /api/chat │ /api/vision │
                        │  (SSE: text + action + done + error)   │
                        │  bytes → POST /api/sessions/:id/documents
                        ▼                                         │
                  Express                                         │
                    requireAuth (or dev bypass)                  │
                    sessionStore.{memory,supabase}               │
                    documentStore.{memory,supabaseStorage}       │
                    Anthropic SDK streaming + agent loop ────────┘
                    └→ Supabase (auth + sessions table + documents bucket)
```

### What's solid

- **Single Zustand store** (`apps/web/src/store/seneca.ts`) holds all cross-cutting client state. Selectors are stable; no tearing issues observed.
- **Streaming chat path** (`apps/api/src/routes/chat.ts`) is one handler powering both `/api/chat` and `/api/vision`, branching on whether a body image is present.
- **Server-side agent loop** with synthetic `tool_result: "ok"` between iterations lets Seneca chain multiple tool calls in one turn. See [`actions.md`](actions.md).
- **Dev-bypass + session-store abstraction** (`apps/api/src/lib/sessionStore.ts`) means you can run the entire app with just an Anthropic key (no Supabase). Same `SessionStore` interface backs the Postgres path.
- **Theme system** uses CSS custom properties on `:root` / `.dark` mapped to Tailwind semantic tokens. Adding a new theme means defining a new selector block in `src/index.css`. Excalidraw follows along via its `theme` prop.
- **Tool-chip UI** (`apps/web/src/components/VoicePane/ToolChips.tsx`) is friendly, expandable, and colour-coded by status; presenters live in `lib/toolSummary.ts`.
- **Error UX** has structured `SystemNotice` + auto-retry (transient) + manual Retry button on a `role: "system"` transcript entry. The `ApiError` class carries HTTP status so callers can decide.
- **Build is clean** — typecheck passes, no lints, full build under 10s.

### Known technical debt (ordered by impact)

The list below is the shortened post-Phase-7 view; closed items are kept as ~~struck~~ entries so historical references in commit messages and elsewhere still resolve to the right number.

1. ~~**Tool-result round-trip across turns is disabled.**~~ **Closed in Phase 3.** `TranscriptMessage.tools` carries assistant `tool_use` blocks; the agent loop persists them, `buildAnthropicMessages` re-emits them, and the client drains a `pendingToolResults` queue into every turn's `ChatRequest`. Real failure strings now reach Seneca on the next turn.
2. ~~**No session list UI.**~~ **Closed in Phase 3.** `SessionsModal` ships create / rename / delete (inline confirm); the AppShell header opens it; `CanvasContainer` keys on `sessionId` so a switch fully remounts every tab.
3. ~~**Server-side transcript persistence is text-only.**~~ **Closed in Phase 3 along with #1.** `tools` round-trips on every assistant `TranscriptMessage`.
4. ~~**Excalidraw + StrictMode is disabled globally.**~~ **Closed in Phase 7.** `CanvasContainer` wraps every non-whiteboard tab subtree in `<StrictMode>` while WhiteboardTab stays on its plain mount — see the file-level comment in `CanvasContainer.tsx` and the `main.tsx` gotcha block.
5. ~~**`whiteboardBgFor()` hardcodes hex colours.**~~ **Closed in Phase 7.** The function now reads `--c-surface` from the document root via `getComputedStyle`, caches by theme, and re-reads on theme switch via `invalidateWhiteboardBgCache`. Fallback constants are kept for SSR / test contexts where `document` isn't defined.
6. ~~**No tests.**~~ **Closed in Phase 1.** ~280 unit tests across the three workspaces; CI runs `typecheck`, `test`, and `build` on every push and PR. Run `pnpm test` locally.
7. ~~**No cost telemetry.**~~ **Closed in Phase 4.** Per-turn + per-session token / dollar pill in the AppShell header, backed by `pricing.ts` + the new `usage` SSE event.
8. ~~**Lint tightening.**~~ **Closed in Phase 1.** `noUnusedLocals` + `noUnusedParameters` on globally. Two deliberate `react-hooks/exhaustive-deps` opt-outs documented inline (mount-once setup effects in MapTab / WebTab).
9. ~~**No request-coalescing on whiteboard saves.**~~ **Closed in Phase 7.** `WhiteboardTab` keeps an `AbortController` per in-flight `PUT /whiteboard` save; a fresh save aborts the prior one so we never queue stale snapshots ahead of fresh ones.
10. ~~**Seneca cannot read PDF text without vision capture.**~~ **Closed in Priority 1a.** Born-digital → cheap text path via `document_read_page`; scanned → server-rasterised multimodal `tool_result` image.
11. **No OCR layer for scanned PDFs.** Priority 1a's visual fallback handles scanned PDFs *gracefully*, but every read still costs vision-grade tokens. Tesseract.js works in Node but is slow; cloud OCR (AWS Textract, Google Vision, Azure Document Intelligence) is fast but adds a paid dependency. Defer until usage data justifies the spend — the sidebar already pills these as "Scan" so the cost story is visible.

### Hot files to read first

When ramping in, read in this order:

1. [`docs/vision.md`](vision.md) — the spec.
2. [`packages/shared/src/types.ts`](../packages/shared/src/types.ts) — the wire and persistence shapes.
3. [`packages/shared/src/prompt.ts`](../packages/shared/src/prompt.ts) — Seneca's voice.
4. [`packages/shared/src/tools.ts`](../packages/shared/src/tools.ts) — available tools.
5. [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) — the agent loop heart of the backend.
6. [`apps/web/src/lib/runTurn.ts`](../apps/web/src/lib/runTurn.ts) — the orchestrator on the client.
7. [`apps/web/src/store/seneca.ts`](../apps/web/src/store/seneca.ts) — UI state.
8. [`apps/web/src/components/Canvas/WhiteboardTab.tsx`](../apps/web/src/components/Canvas/WhiteboardTab.tsx) — has load-bearing comments about non-obvious patterns.
9. [`apps/web/src/components/Canvas/MapTab.tsx`](../apps/web/src/components/Canvas/MapTab.tsx) — same pattern as WhiteboardTab applied to Leaflet; read both side by side when adding the next tab.
10. [`apps/web/src/components/Canvas/WebTab.tsx`](../apps/web/src/components/Canvas/WebTab.tsx) and [`apps/api/src/lib/webProxy.ts`](../apps/api/src/lib/webProxy.ts) — the third instance of the bridge / capturer / debounced-persist pattern, plus a non-trivial server-side proxy with SSRF guard and HTML sanitisation.
11. [`apps/web/src/components/Canvas/DocumentTab.tsx`](../apps/web/src/components/Canvas/DocumentTab.tsx) and [`apps/api/src/routes/documents.ts`](../apps/api/src/routes/documents.ts) — the fourth instance of that same pattern, plus the only tab that round-trips real binary blobs through the API and a separate `documentStorage` abstraction. Read these *before* adding any new tab that needs file storage.
12. [`docs/actions.md`](actions.md) — protocol contract, useful when adding new tools.

---

## 3. Vision tracking

### MVP scope (vision §7)

| Requirement | Status | Where |
|---|---|---|
| Single-user email/password auth (Supabase) | ✅ | `auth/AuthProvider.tsx`, `middleware/auth.ts` |
| Dev-bypass mode | ✅ extra | `lib/devBypass.ts`, `lib/sessionStore.ts` |
| Persistent session list (create, name, resume, delete) | ✅ | `apps/api/src/routes/sessions.ts`, `apps/web/src/components/Sessions/SessionsModal.tsx` |
| Voice pane (STT, TTS, transcript, mute/pause, vision toggle) | ✅ | `components/VoicePane/*`, `hooks/use*` |
| Text input fallback | ✅ | inside `VoicePane.tsx` |
| Whiteboard tab | ✅ | `components/Canvas/WhiteboardTab.tsx` |
| Document tab (PDF upload + viewing) | ✅ | `components/Canvas/DocumentTab.tsx`, `lib/documentActions.ts`, `lib/documentBridge.ts`, `apps/api/src/routes/documents.ts`, `apps/api/src/lib/documentStorage.ts` |
| Web tab (URL input + sanitised proxy) | ✅ | `components/Canvas/WebTab.tsx`, `lib/webActions.ts`, `lib/webBridge.ts`, `apps/api/src/routes/web.ts` |
| Map tab (Leaflet, layers, AI pins/fly-to) | ✅ | `components/Canvas/MapTab.tsx`, `lib/mapActions.ts`, `lib/mapBridge.ts` |
| Vision toggle (capture active canvas → Claude) | ✅ | `components/VoicePane/VisionToggle.tsx`, `lib/captureCanvas.ts` |
| AI action execution (whiteboard) | ✅ | server agent loop + `lib/actionDispatcher.ts` |
| AI action execution (map) | ✅ | `lib/mapActions.ts` (fly-to, drop pin, draw shape, set layer) |
| AI action execution (web) | ✅ | `lib/webActions.ts` (navigate, search) |
| AI action execution (document) | ✅ | `lib/documentActions.ts` (`document_go_to_page`), `apps/api/src/routes/chat.ts` (`document_read_page` server-fulfilled with scanned-PDF visual fallback; `document_list` and `document_search` server-fulfilled so Seneca can introspect and find phrases without a sidebar peek) |
| AI action execution (tab.switch) | 🟡 | Implicit auto-switching already happens in dispatcher; explicit `tab_switch` tool intentionally deferred |
| AI-authored documents (`document_create`) | ✅ extra | `apps/api/src/routes/chat.ts` (`resolveDocumentCreate`), `packages/shared/src/tools.ts` |
| Multi-format document support (.docx, .pptx, .md, .txt, .html) | ✅ | `apps/api/src/lib/documentExtractors/`, `apps/web/src/components/Canvas/MarkdownViewer.tsx` |
| Cost telemetry (per-turn + per-session) | ✅ extra | `apps/api/src/lib/pricing.ts`, `apps/web/src/components/CostPill.tsx` |

### Acceptance criteria (vision §8)

Per-section detail; tick when every subcriterion passes.

- **§8.1 Auth & Session Management** — ✓. Auth ✓. Session list ✓ (`SessionsModal` with create / rename / delete + cascade cleanup of document text / chunks / bytes / storage prefix). Persistence across logout ✓ in real-auth mode.
- **§8.2 Voice Pane** — ✓ all bullets.
- **§8.3 Vision Toggle** — ✓ all bullets. Capture works for whiteboard and map; doc / web tabs land with their respective slices.
- **§8.4 Whiteboard Tab** — ✓ all bullets except: AI free-draw renders as multi-point line (deliberate; documented).
- **§8.5 Document Tab** — ✓. PDF + `.docx` + `.pptx` + `.md` / `.markdown` / `.txt` + `.html` / `.htm` upload through the extractor registry (drag-drop + file picker, ≤25 MB, magic-byte + mime + extension dispatch). Multi-document sidebar with click-to-switch, inline confirm-on-delete, text-status + index-status pills, and a "✦" badge on AI-authored docs. PDFs render through react-pdf with prev / next / jump / page-of-N; markdown / docx / pptx / html render through the themed `MarkdownViewer`. Files in Supabase Storage (private `seneca-documents` bucket) in real-auth mode, a process-local `Map<docId, Buffer>` in dev-bypass; AI-authored markdown lives inline in `document_pages` with no Storage blob. **Seneca can read every format directly** via `document_read_page` (born-digital text path + scanned-PDF visual fallback). **Seneca knows what's loaded** via `document_list`, and **finds phrases semantically** via `document_search` (cosine top-k over Voyage embeddings + pgvector, substring fallback). **Seneca can also write new docs** via `document_create` — markdown stays inline, the SSE `documents-updated` event makes the sidebar update mid-turn.
- **§8.6 Web Tab** — ✓ all bullets. URL bar + back/forward/reload + sanitised proxy + AI navigate + AI search with clickable card list.
- **§8.7 Map Tab** — ✓ all bullets. Leaflet renders fullscreen; standard + satellite tile layers; user draws via leaflet-draw; AI flies, pins, draws via `map_*` tools; layer toggle in the corner; state persists.
- **§8.8 AI Action Execution** — ✓. Schema ✓ for whiteboard + map + web + documents. Streaming dispatch ✓. Auto-tab-switch ✓. Failure-feedback round-trip ✓ (Phase 3 — `pendingToolResults` queue drains into the next turn's `ChatRequest`; server synthesises matching `tool_result` blocks from the persisted `tool_use` records).
- **§8.9 Tab System** — ✓ all four tabs (whiteboard, map, web, documents) functional. Explicit `tab_switch` tool deferred — auto-switch already happens whenever a tool fires for a non-active tab.
- **§8.10 Session Persistence** — ✓. Whiteboard scene, map state, web URL+history, documents metadata + active doc + per-doc current page, transcript text + persisted `tool_use` records (Phase 3), and rolling per-session cost totals (Phase 4) all persist. PDF bytes persist in Supabase Storage (real-auth) or in-process Map (dev-bypass). AI-authored markdown persists inline in `document_pages` with no Storage blob.

### Open questions (vision §11)

| # | Question | Resolution |
|---|---|---|
| 11.1 | Tool-use API vs XML | ✅ Tool-use API (Anthropic). Decision documented in [`actions.md`](actions.md). |
| 11.2 | Whiteboard scene-JSON vs PNG for vision | 🟡 Shipping PNG (matches vision §6 dataflow). Scene-JSON experiment deferred. |
| 11.3 | Web proxy depth | 🟡 Decision documented (strip all JS) but tab not yet built. |
| 11.4 | TTS quality | 🟡 Browser TTS shipped. Upgrade to ElevenLabs only if it breaks usability. |
| 11.5 | System prompt persona | ✅ Hardcoded Seneca persona in `packages/shared/src/prompt.ts`. |
| 11.6 | Rate limits / abuse | 🔒 Deferred until productisation. |
| 11.7 | OSS licensing (MIT vs AGPL) | ✅ MIT. Top-level [`LICENSE`](../LICENSE) shipped in Phase 1; referenced from the README. Free to push the repo public. |
| 11.A | Cross-turn tool_result reporting | ✅ Phase 3 closed this — assistant `tool_use` blocks persist on `TranscriptMessage.tools` and round-trip cleanly. |
| 11.B | Embeddings provider for document RAG | ✅ Voyage AI (`voyage-3-large`, 1024-dim). Shipped in Priority 1b. Configurable via `VOYAGE_API_KEY` + `VOYAGE_MODEL`; default model has the best quality / cost ratio for Anthropic's recommended partner. Substring fallback kicks in if the key is unset or the API errors. |
| 11.C | OCR for scanned PDFs | 🟡 Revisit when usage data justifies it — the visual fallback handles scanned PDFs gracefully today. See tech debt #11. |
| 11.D | Storage of AI-authored documents | ✅ Phase 6 shipped: markdown inline in `document_pages.text` with no Storage blob, `origin: "ai-created"` on the record. PDF export still deferred until a real user asks. |

---

## 4. Recommended next steps (prioritised)

Every MVP priority (1a / 1b / 1c / 1d / 2 / 3 / 4) and every closeable tech-debt item (#1, #2, #3, #4, #5, #6, #7, #8, #9, #10) have shipped. The remaining roadmap is small:

> **What's left, in order:**
> 1. **OCR upgrade for scanned PDFs** (tech-debt #11 / vision §11.C) — only when usage data shows scanned-PDF reads are eating the cost budget. Pick Tesseract.js (free, slow) or a cloud OCR provider; route the OCR output into `document_pages.text` so a normal cheap text read takes over.
> 2. **`document_edit` collaborative editing** (Priority 1d stretch goal) — a real editor UX (Monaco / Notion-style block editor) plus a `document_edit` tool that takes a unified diff and a UI for accept / reject. Separate UX project.
> 3. **PDF export of AI-authored docs** (vision §11.D) — server-side render via puppeteer or similar. Wait for a real user request.
> 4. **Mobile-optimised layout** (vision §10 Phase 5) — desktop-first by design; tackle after a few weeks of dogfooding.
> 5. **ElevenLabs TTS upgrade** (vision §11.4) — only if browser TTS becomes a usability blocker.
> 6. **Multi-persona switching** (vision §11.5) — explicitly post-MVP.
> 7. **`tab_switch` explicit tool** — auto-switch already happens whenever a tool fires on a non-active tab; add only if Seneca needs to switch *without* mutating that tab.
> 8. **Web tab in-iframe link interception / reader-mode** — requires injecting JS into the sandboxed iframe; deferred until a real user friction emerges.

Done items below are kept for context — they cover the journey from MVP Phase 1 through Phase 7 cleanup. The order matches the build sequence; each entry names its entry point files so the next agent can navigate the codebase by feature.

### ✅ Done — Map tab (Phase 3, vision §8.7)

Shipped. Leaflet + leaflet-draw integration with persistence, vision capture, and four `map_*` tools. The Caspian energy corridor demo from vision §4.2 works end-to-end. Hot files for future maintenance: [`apps/web/src/components/Canvas/MapTab.tsx`](../apps/web/src/components/Canvas/MapTab.tsx), [`apps/web/src/lib/mapActions.ts`](../apps/web/src/lib/mapActions.ts), [`apps/web/src/lib/mapBridge.ts`](../apps/web/src/lib/mapBridge.ts).

### ✅ Done — Web tab (Phase 3, vision §8.6)

Shipped. Sanitised HTML proxy with SSRF guard, Tavily-backed search with a clickable card list, URL bar with back / forward / reload, vision capture, and persistence (URL + history). Hot files: [`apps/web/src/components/Canvas/WebTab.tsx`](../apps/web/src/components/Canvas/WebTab.tsx), [`apps/web/src/lib/webActions.ts`](../apps/web/src/lib/webActions.ts), [`apps/api/src/lib/webProxy.ts`](../apps/api/src/lib/webProxy.ts), [`apps/api/src/routes/web.ts`](../apps/api/src/routes/web.ts).

### ✅ Done — Document tab (Phase 3, vision §8.5)

Shipped. PDF upload via drag-drop or file picker (≤25 MB, magic-byte validated server-side), react-pdf viewer with prev / next / jump-to-page / page-of-N, multi-document sidebar with click-to-switch and inline confirm-on-delete, native text selection via the PDF.js text layer, vision capture (snapshots the rendered page canvas only — not the chrome), and `document_go_to_page` for AI-driven navigation. Bytes live in a private Supabase Storage bucket (`seneca-documents`, path `{userId}/{sessionId}/{docId}.pdf`) in real-auth mode and a process-local `Map<docId, Buffer>` in dev-bypass mode — both implement one `DocumentStore` interface so the rest of the codebase doesn't branch.

**Known limitation (intentional for this slice):** Seneca can navigate but cannot read the text content of a PDF without the user toggling vision capture. He's been prompted to ask for that toggle when text-reading is needed, but a real solution is server-side text extraction and a cheap text-only read tool (and eventually RAG over many docs and AI-authored documents) — see Priority 1 below.

Hot files: [`apps/web/src/components/Canvas/DocumentTab.tsx`](../apps/web/src/components/Canvas/DocumentTab.tsx), [`apps/web/src/components/Canvas/DocumentSidebar.tsx`](../apps/web/src/components/Canvas/DocumentSidebar.tsx), [`apps/web/src/components/Canvas/DocumentToolbar.tsx`](../apps/web/src/components/Canvas/DocumentToolbar.tsx), [`apps/web/src/components/Canvas/DocumentDropZone.tsx`](../apps/web/src/components/Canvas/DocumentDropZone.tsx), [`apps/web/src/lib/documentActions.ts`](../apps/web/src/lib/documentActions.ts), [`apps/web/src/lib/documentBridge.ts`](../apps/web/src/lib/documentBridge.ts), [`apps/api/src/routes/documents.ts`](../apps/api/src/routes/documents.ts), [`apps/api/src/lib/documentStorage.ts`](../apps/api/src/lib/documentStorage.ts).

### ✅ Done — Priority 1a (text extraction + `document_read_page` with multimodal scanned-PDF fallback)

Shipped. Server-side text extraction runs synchronously on upload using `pdfjs-dist` (Node legacy build); per-page rows live in a new `document_pages` Postgres table (with RLS via the join through `sessions.user_id`) in real-auth mode and a `Map<docId, DocumentPageText[]>` in dev-bypass — both implement a single `DocumentTextStore` interface. The new `document_read_page` server-fulfilled tool resolves doc + page from explicit input → in-turn navigation → persisted active doc, hits the text store first, lazy-extracts on demand for legacy uploads, and falls back to server-side page rasterisation (`pdfjs-dist` + `@napi-rs/canvas`) returned as a *multimodal* `tool_result` (image block + caption) for scanned PDFs. The eye-toggle is no longer needed for any "what does this document say?" question — Seneca handles both born-digital and scanned PDFs transparently in the same iteration. A sidebar pill (`Text` / `Scan` / `?` / `…`) makes the cost story visible to the user.

Hot files: [`apps/api/src/lib/pdfTextExtractor.ts`](../apps/api/src/lib/pdfTextExtractor.ts), [`apps/api/src/lib/pdfPageRenderer.ts`](../apps/api/src/lib/pdfPageRenderer.ts), [`apps/api/src/lib/documentTextStore.ts`](../apps/api/src/lib/documentTextStore.ts), [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) (`resolveDocumentReadPage`), [`apps/api/src/routes/documents.ts`](../apps/api/src/routes/documents.ts) (upload-time extraction), [`packages/shared/src/tools.ts`](../packages/shared/src/tools.ts) (`DOCUMENT_READ_PAGE`), [`packages/shared/src/prompt.ts`](../packages/shared/src/prompt.ts).

Schema migration: the `document_pages` table is new — existing real-auth deployments need to run the migration block in [`docs/setup.md`](setup.md) §3.1 before the new tool will work. Dev-bypass installs need no migration; the in-memory store reseeds itself on restart.

### ✅ Done — `document_list` and `document_search` (introspection + naive search)

Shipped. Two new server-fulfilled tools landed on top of Priority 1a so Seneca answers "what have I uploaded?" and "where does it say X?" without a sidebar peek:

- **`document_list`** — zero-arg tool that projects the session's persisted `DocumentsState` into a `tool_result` envelope `{count, activeId, items: [{id, name, filename, pageCount, currentPage, textStatus, active}]}`. Pure read, no IO, resolver in `resolveDocumentList` inside [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts).
- **`document_search`** — `{query, top_k?, document_id?}` returns ranked page hits `{documentId, documentName, page, snippet, score}`. Today's implementation is a naive case-insensitive substring search over the per-page text in [`apps/api/src/lib/documentTextStore.ts`](../apps/api/src/lib/documentTextStore.ts); `score` is the raw hit-count on the page. Docs without extracted text yet are skipped and reported under `skipped` so Seneca can mention it honestly. Resolver in `resolveDocumentSearch` inside `chat.ts`. **The wire shape is the contract** — Priority 1b's vector retrieval will swap the inner scoring loop for embeddings without touching the tool definition, the prompt, the client dispatcher, or the chip presenter.

Closed a UX gap the user surfaced directly: before this slice Seneca would say "the sidebar is on your side of the interface" when asked what was loaded. The system prompt now points him at `document_list` as his first move whenever the user asks "what have I given you?".

Hot files: [`packages/shared/src/tools.ts`](../packages/shared/src/tools.ts) (`DOCUMENT_LIST`, `DOCUMENT_SEARCH`, `DocumentSearchHit`), [`packages/shared/src/prompt.ts`](../packages/shared/src/prompt.ts), [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) (`resolveDocumentList`, `resolveDocumentSearch`), [`apps/web/src/lib/actionDispatcher.ts`](../apps/web/src/lib/actionDispatcher.ts) (no-op chip branches), [`apps/web/src/lib/toolSummary.ts`](../apps/web/src/lib/toolSummary.ts) (chip labels). No schema migration required.

### ✅ Done — Priority 1b (vector retrieval upgrade of `document_search`)

Shipped. `document_search` now runs as a cosine top-k retrieval over chunked embeddings produced by Voyage AI (`voyage-3-large`, 1024-dim), with the naive substring scoring loop retained as a graceful fallback when Voyage is unconfigured or upstream errors. The wire shape stayed identical to Priority 1a's contract — every caller (prompt, dispatcher, chip presenter) reads unchanged.

What landed:

- **Voyage AI client** in [`apps/api/src/lib/voyageEmbeddings.ts`](../apps/api/src/lib/voyageEmbeddings.ts) — thin `fetch` wrapper around `https://api.voyageai.com/v1/embeddings`, batched to 96 inputs per call with a 30s per-batch timeout, plus a pure `cosineSimilarity` helper normalised to `[0, 1]` (orthogonal → 0.5, opposite → 0, identical → 1). Surfaces two failure modes: `VoyageNotConfiguredError` (no key → substring fallback) and `VoyageRequestError` (HTTP / network → substring fallback + sidebar pill goes red).
- **Chunker** in [`apps/api/src/lib/pdfChunker.ts`](../apps/api/src/lib/pdfChunker.ts) — splits each `DocumentPageText` into ~500-token windows with ~50-token overlap, preferring paragraph / sentence boundaries when within the last 25% of the target window. Token approximation is `chars / 4`. Page numbers are preserved on every chunk so a hit can chain into `document_go_to_page`.
- **Chunk store** in [`apps/api/src/lib/documentChunkStore.ts`](../apps/api/src/lib/documentChunkStore.ts) — interface mirroring `documentTextStore`. Memory impl brute-forces cosine (fine for the few-thousand chunks a dev session holds). Supabase impl pushes the math into pgvector via a `match_document_chunks` RPC defined in [`docs/setup.md`](setup.md) §3.1 step 6.5; the RPC uses `vector_cosine_ops` with an `ivfflat` index.
- **Indexing pipeline** runs synchronously at upload in [`apps/api/src/routes/documents.ts`](../apps/api/src/routes/documents.ts) — text extraction → chunker → Voyage embed → chunk store put. New `DocumentRecord.indexStatus` field tracks state (`pending` / `indexing` / `indexed` / `skipped` / `failed`); the sidebar pills it next to `textStatus`. Failure paths roll back bytes + pages + chunks together so we never orphan storage.
- **Two-engine resolver** in `resolveDocumentSearch` ([`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts)) — tries vector first when `VOYAGE_API_KEY` is set and at least one in-scope doc has `indexStatus: "indexed"`. Falls back to substring on Voyage failure, on empty top-k, or whenever no in-scope doc is indexed. The `engine` field on the tool_result envelope tells Seneca which engine ran so he can reason about result quality.
- **Sidebar pill** in [`apps/web/src/components/Canvas/DocumentSidebar.tsx`](../apps/web/src/components/Canvas/DocumentSidebar.tsx) — new `IndexStatusPill` component renders alongside `TextStatusPill` so the user sees indexing state at a glance.
- **Tests** — chunker boundary conditions + overlap detection (11 cases), Voyage cosine math + edge cases (9 cases), chunk store ranking + user / session / doc isolation + delete cascades (10 cases), resolver vector path with stubbed Voyage + chunk store + substring fallback (7 cases). 135 API tests pass.
- **Docs** — [`docs/setup.md`](setup.md) §2.6 walks through Voyage signup; §3.1 step 6.5 adds the `pgvector` migration + `match_document_chunks` RPC, plus a delta block for existing real-auth deployments. [`docs/actions.md`](actions.md) `document_search` section documents the two engines and graceful-degradation rules. [`apps/api/.env.example`](../apps/api/.env.example) flags the optional Voyage env vars.

Schema migration: existing real-auth deployments need to run the `pgvector` enable + `document_chunks` block in [`docs/setup.md`](setup.md). Without it, `document_search` works fine — it just falls back to substring on every query. Dev-bypass installs need no migration; the in-memory store is allocated on first use.

### ✅ Done — Priority 1c (multi-format document support)

Shipped. Uploads accept PDF, `.docx`, `.pptx`, `.md` / `.markdown` / `.txt`, and `.html` / `.htm` end-to-end. Search and read tools work uniformly across formats — they operate on the per-page extracted text the registry produces, so a query across a mixed-format session lands hits without any per-format branching.

What landed:

- **Extractor registry** in [`apps/api/src/lib/documentExtractors/`](../apps/api/src/lib/documentExtractors/) — `types.ts` defines the `DocumentExtractor` interface (`mimes`, `extensions`, `sniff`, `extract`, `renderHint`); `index.ts` exposes `selectExtractor` (mime → extension → magic-byte sniff, in that priority) plus `allSupportedMimes()` for the upload validator.
- **Concrete extractors** — `pdf.ts` (wraps the existing `pdfTextExtractor` so PDF behaviour is byte-for-byte identical to pre-Phase 5), `markdown.ts` (UTF-8 sniff, heading-driven page split with length fallback), `docx.ts` (`mammoth.convertToMarkdown` + the same page-splitter), `pptx.ts` (`jszip` over `ppt/slides/slideN.xml`, one slide per page), `html.ts` (reuses `extractTextFromHtml` from `webProxy.ts`).
- **Upload route** in [`apps/api/src/routes/documents.ts`](../apps/api/src/routes/documents.ts) — `rawPdfParser` replaced with `rawUploadParser` whose `express.raw({ type: cb })` callback claims any mime the registry knows about plus `application/octet-stream`. `looksLikePdf` is gone from the route; the registry's sniff does the dispatch.
- **`DocumentRecord` extensions** in [`packages/shared/src/types.ts`](../packages/shared/src/types.ts) — `mime?: string` and `renderHint?: "pdfjs" | "markdown" | "html"`. Legacy records (pre-Phase 5) read as `"pdfjs"` so existing PDFs render unchanged.
- **DocumentTab branching** in [`apps/web/src/components/Canvas/DocumentTab.tsx`](../apps/web/src/components/Canvas/DocumentTab.tsx) — `pdfjs` keeps the react-pdf path; every other hint loads `/api/sessions/:id/documents/:docId/pages` and renders through the new `MarkdownViewer` (themed `marked` + DOMPurify).
- **Sidebar + drop-zone** — accept lists widened to include the new mimes / extensions; the empty-state copy mentions the supported formats. The picker validates client-side using the same canonical list the registry validates server-side.
- **Tests** — `registry.test.ts` covers selection priority + sniff disambiguation (docx vs pptx); `markdown.test.ts` covers BOM / NUL / binary rejection and the pageify heuristic; `pptx.test.ts` builds a synthetic deck via JSZip and round-trips it through the real extractor. 196 API tests + 82 web tests pass.

No schema migration: `DocumentRecord` lives entirely inside the existing `sessions.documents` JSONB column.

### ✅ Done — Priority 1d (`document_create` — AI-authored documents)

Shipped. Seneca can author markdown documents that materialise in the user's sidebar with a small "✦" badge, are immediately searchable via `document_search`, and behave exactly like uploaded docs for the read / navigate / list tools.

What landed:

- **Shared tool definition + types** in [`packages/shared/src/tools.ts`](../packages/shared/src/tools.ts) — `DOCUMENT_CREATE` (`{title, content, format?: "markdown"}`); registered in `ALL_TOOLS` and the `ToolName` union.
- **System prompt** in [`packages/shared/src/prompt.ts`](../packages/shared/src/prompt.ts) — new paragraph telling Seneca when to reach for this (durable artefacts: summaries, outlines, study guides) and when not to (short answers belong in chat).
- **`DocumentRecord.origin`** in [`packages/shared/src/types.ts`](../packages/shared/src/types.ts) — `"upload" | "ai-created"`; legacy records (no field) read as `"upload"`.
- **Resolver** `resolveDocumentCreate` in [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) — validates title / content (caps at 80 / 25,000 chars), pageifies through the same `markdown._internals.pageify` the upload path uses, persists per-page text inline through `documentTextStore.put`, embeds + indexes when `VOYAGE_API_KEY` is set (falls back to `skipped` / `failed` cleanly), and updates `sessions.documents` with the new `DocumentRecord` (`origin: "ai-created"`, `renderHint: "markdown"`, `mime: "text/markdown"`).
- **In-loop activation** — the resolver mutates `sessionRow.documents` and `activeDocumentId` so a chained `document_go_to_page` later in the same turn lands the user on the freshly-authored doc.
- **`documents-updated` SSE event** in `ChatStreamEvent` ([`packages/shared/src/types.ts`](../packages/shared/src/types.ts)) — server pushes the new `DocumentsState` mid-turn so the sidebar updates without waiting for the next session reload. Client handler lives in [`apps/web/src/lib/runTurn.ts`](../apps/web/src/lib/runTurn.ts) and patches the store via `setDocuments`.
- **DocumentTab subscription** — a new `useSenecaStore.subscribe` effect in [`apps/web/src/components/Canvas/DocumentTab.tsx`](../apps/web/src/components/Canvas/DocumentTab.tsx) detects external `documentsState` mutations (the SSE patch) and merges them into the local `items` / `activeId`, preserving in-tab navigation state. The "snapshot once at mount" pattern is preserved for normal Excalidraw / Leaflet-style mounts.
- **Sidebar badge** — `DocumentSidebar` renders a small "✦" before AI-authored names so the user can tell what they wrote vs what Seneca wrote.
- **Tests** — `chat.document-create.test.ts` covers input validation, persistence, prior-doc preservation, and the indexing fallback (8 cases). `tools.test.ts` checks the new tool's shape. `toolSummary.ts` got a friendly label so the chip reads `write doc · "title"`.

Stretch goal (`document_edit` collaborative editing tool) intentionally deferred — that crosses into a real editor UX project. PDF export of AI-authored docs also deferred per the original handoff note.

**Cross-cutting design principles (apply to all of 1a–1d):**
- Cheap text reads should always be preferred over visual capture *for born-digital text-bearing pages*. The vision toggle stays first-class for diagrams, scanned PDFs, layouts, and any case where the rendered look matters more than the words. Codify this in the system prompt rather than removing the eye toggle.
- Every new doc-related tool should follow the existing patterns: shared definition in `packages/shared/src/tools.ts`, system-prompt mention in `prompt.ts`, dispatcher entry in `apps/web/src/lib/actionDispatcher.ts` (or server-fulfilled like `web_read_page` if it returns content rather than acting on the canvas), friendly chip presenter in `apps/web/src/lib/toolSummary.ts`.
- Storage costs grow fast. Every doc ingestion should write to: bytes (Supabase Storage), per-page text (table), chunks + embeddings (table). When a session is deleted (Priority 2 — auth + session list adds the delete UI), the cascade must wipe all four — write the foreign keys with `ON DELETE CASCADE` now so the auth slice gets cascade-delete for free.
- All four sub-projects must work in *both* real-auth and dev-bypass modes. Preserve the `DocumentStore` interface pattern — extend it to a `DocumentIndex` interface for chunks + embeddings so dev-bypass stays first-class for local dev.

### ✅ Done — Priority 2 (auth gates + session list + cascade delete)

Shipped. Vision §8.1 / §8.10 are fully ticked.

What landed:

- **Sessions API** in [`apps/api/src/routes/sessions.ts`](../apps/api/src/routes/sessions.ts) — `GET /api/sessions`, `POST /api/sessions`, `GET /api/sessions/:id`, `PATCH /api/sessions/:id` (rename), `DELETE /api/sessions/:id`. Both `SessionStore` implementations satisfy the contract.
- **Session list UI** — a `SessionSwitcher` button in the AppShell header opens [`apps/web/src/components/Sessions/SessionsModal.tsx`](../apps/web/src/components/Sessions/SessionsModal.tsx), a modal grid with create / rename / delete (inline confirm) and click-to-load. Backed by [`apps/web/src/lib/sessions.ts`](../apps/web/src/lib/sessions.ts), which reuses `apiJson` (extended to accept `PATCH`).
- **Session switching** — the Zustand store gained `loadSession`, which atomically resets transcript / whiteboard / map / web / documents / streaming / pendingToolResults / vision / activeTab. `CanvasContainer` is keyed by `sessionId` in [`AppShell.tsx`](../apps/web/src/components/AppShell.tsx), so a switch fully remounts every tab subtree — no stale `useState`-snapshot artefacts.
- **Cross-turn `tool_result` round-trip + persisted `tool_use`** (closes tech-debt #1, #2, #3) — `TranscriptMessage` carries `tools: ToolCallRecord[]`. The agent loop in [`chat.ts`](../apps/api/src/routes/chat.ts) accumulates every `tool_use` Claude emits and `appendAssistantTurn` persists them onto the assistant message. `buildAnthropicMessages` re-emits prior `tool_use` blocks and synthesises `tool_result` blocks from `transcript.tools` plus the client's `pendingToolResults` queue (drained on every turn via [`apps/web/src/lib/runTurn.ts`](../apps/web/src/lib/runTurn.ts)). Synthetic `"ok"` acks are gone for the cross-turn path; client-side failures bubble back with their real `error` string.
- **Cascade delete** — the `DELETE /api/sessions/:id` handler explicitly clears `documentTextStore`, `documentChunkStore`, and `documentStore` per-doc, then performs a session-scoped sweep through the new `deleteForSession` methods (added to all three stores in memory + Supabase). Storage bucket prefixes are paginated through `list` / `remove`.
- **Schema** — `document_pages` and `document_chunks` got a `session_id uuid` column so the per-session cleanup query is a single `DELETE WHERE session_id = $1` without re-reading docs. Migration block lives in [`docs/setup.md`](setup.md).
- **Tests** — `sessions.test.ts` covers every endpoint plus the cascade delete (text + chunks + bytes all empty after delete). `seneca.test.ts` covers `loadSession` and the new `enqueueToolResult` / `drainToolResults` API. Both `documentStorage.test.ts` and `documentTextStore.test.ts` add `deleteForSession` round-trip tests.

### ✅ Done — Priority 3 (Phase 1: lightweight test harness + CI + license)

Shipped. Vitest landed in all three workspaces; ~190 unit tests run under `pnpm test`. GitHub Actions runs typecheck + test + build on every push and PR (`.github/workflows/ci.yml`). `noUnusedLocals` / `noUnusedParameters` are now on globally. MIT `LICENSE` shipped at the repo root.

What's covered:

- **`packages/shared`**: every tool definition's name/shape/required fields, `DEFAULT_*` state constants.
- **`apps/api`**:
  - `webProxy.ts` — full SSRF guard sweep on IPv4 + IPv6 block lists, including IPv4-mapped IPv6; `parseUrl` rejects non-http schemes; `extractTextFromHtml` strips scripts, decodes entities, truncates correctly.
  - `documentStorage.ts` — `looksLikePdf` magic-byte sniff, memory `DocumentStore` round-trip + user / session isolation.
  - `documentTextStore.ts` — memory impl put / getAll / getPage / replace-on-put / delete.
  - `sessionStore.ts` — every interface method on the memory impl, including ownership-check failure modes.
  - `chat.ts` (`_internals` namespace export) — `clampPage`, `clampMaxChars`, `clampTopK`, `buildAnthropicMessages` (system entries stripped, role mapping, image attached to *last* user turn only, prior `toolResults` attached as content blocks), `resolveDocumentList` (count / active-flag / legacy textStatus default), `resolveDocumentSearch` (empty query rejected, no-docs note, unknown-id note, top-k clamp, case-insensitive scoring, doc-scoped queries, skipped reporting).
- **`apps/web`**:
  - `runTurn.ts` indirectly via `isTransientStatus`.
  - `actionDispatcher.ts` — every tool routes correctly, server-fulfilled branches don't touch the bridges, unknown-tool path returns `ok=false`, coercion failure surfaces as `ok=false` with the error message.
  - `whiteboardActions.ts`, `mapActions.ts`, `webActions.ts`, `documentActions.ts` — coercers reject every garbage shape, accept valid ones, clamp / trim as documented; apply functions thread through their bridges.
  - `toolSummary.ts` — friendly labels for every tool, summaries match the JSON shape.
  - `api.ts` — `isTransientStatus` + `ApiError.transient`.

Internal helpers (`buildAnthropicMessages`, the resolvers, the clamps, `isPrivate*`) are exposed through a small `_internals` namespace at the bottom of each file (same pattern as `runTurn.ts`); the public surface stays unchanged.

Still uncovered (deliberately deferred — needs PDF fixtures or a fake Anthropic stream): the live `pdfTextExtractor` + `pdfPageRenderer` pipeline, end-to-end `routes/documents.ts` upload flow, the Anthropic agent loop's iteration mechanics, and the `Tavily` 503 path. These slot in as Phase 2 / Phase 3 lands and the harness can mock the SDKs cleanly.

### ✅ Done — Priority 4 (cost telemetry)

Shipped. Per-turn token counts + cost stream out as a new SSE event, accumulate client-side, and surface in a header pill.

What landed:

- **Pricing lib** in [`apps/api/src/lib/pricing.ts`](../apps/api/src/lib/pricing.ts) — `pricingFor(model)` returns `$/Mtok` rates for the Sonnet / Opus / Haiku families with conservative fallbacks for unknown models; `computeCostUSD(model, usage)` does the arithmetic including cache read / write tokens.
- **SSE event** — new `UsageStreamEvent` (`type: "usage"`) in [`packages/shared/src/types.ts`](../packages/shared/src/types.ts) carries input / output / cache tokens + the dollar split.
- **Server** — [`chat.ts`](../apps/api/src/routes/chat.ts) accumulates `usage` across agent-loop iterations into a `ClaudeTurnUsage`, computes cost, emits the SSE event after the final iteration, and calls `accumulateSessionUsage` (new `bumpUsage` method on `SessionStore`) so the per-session rolling totals persist in the `sessions.usage` JSONB column.
- **Client** — Zustand state gained `lastTurnUsage` + `sessionUsage` plus `applyUsageEvent` / `setSessionUsage` / `resetUsage`. The new [`CostPill`](../apps/web/src/components/CostPill.tsx) in the AppShell header reads them.
- **Schema** — `sessions.usage jsonb` added in [`docs/setup.md`](setup.md) with a migration block for existing deployments.
- **Tests** — `pricing.test.ts` (lookup + cache derivation + invalid input), `seneca.test.ts` (apply + reset), `sessionStore.test.ts` (`bumpUsage` initialisation + accumulation + non-owner no-op).

### Deferred / mode-dependent

- OCR for scanned PDFs (tech-debt #11 / vision §11.C) — the visual fallback is sufficient; revisit when scanned-PDF reads start dominating the cost budget.
- `document_edit` collaborative editing (Priority 1d stretch) — separate UX project.
- PDF export of AI-authored docs (vision §11.D) — wait for demand; puppeteer-style render at create time.
- Mobile layout — vision §3 says desktop-first; tackle after a few weeks of dogfooding (vision §10 Phase 5).
- ElevenLabs TTS upgrade — only if browser TTS becomes a real blocker.
- Multi-persona switching — explicitly deferred to post-MVP per vision §11.5.
- `map_clear` tool / "Clear map" UI button — out of scope for the slice; the user can delete features individually via the leaflet-draw edit toolbar today.
- Web tab in-iframe link interception — links open in a new browser tab. Re-fetching them through the proxy would mean injecting JS into the sandboxed iframe, which we explicitly avoid. Defer until a real user friction emerges.
- Web tab reader-mode (Mozilla Readability pass on the proxied HTML) — would dramatically improve readability for many sites but is a non-trivial second-pass project.

---

## 5. Gotchas and load-bearing decisions

Read this list before touching the files mentioned. These bit us once and shouldn't bite again.

### `apps/web/src/main.tsx` — no root-level StrictMode; localized StrictMode in CanvasContainer

Excalidraw 0.18's `useSyncExternalStore` infinite-loops during the StrictMode double-mount cleanup phase. We surfaced this as "Maximum update depth exceeded" originating in `Set.forEach` inside Excalidraw's store. The root render in `main.tsx` is deliberately *not* wrapped in `<StrictMode>` for that reason.

Phase 7 closed the half-fix: [`CanvasContainer.tsx`](../apps/web/src/components/Canvas/CanvasContainer.tsx) now wraps every canvas tab subtree EXCEPT `WhiteboardTab` in `<StrictMode>` (each of `TabBar`, `MapTab`, `WebTab`, `DocumentTab` mounts under its own StrictMode block). That recovers the effect-cleanup safety checks for the simpler tabs while keeping the whiteboard on its working mount semantics. **Do not move StrictMode back to `main.tsx` or wrap WhiteboardTab in StrictMode** until Excalidraw upstream fixes the issue.

### `apps/web/src/components/Canvas/WhiteboardTab.tsx` — read whiteboard ONCE

Do **not** add `useSenecaStore((s) => s.whiteboard)`. Doing so creates: `onChange → setWhiteboard → selector fires → initialData prop identity changes → Excalidraw setState in cleanup → infinite loop`. The pattern is `useState(() => store.getState().whiteboard)` to snapshot at mount. The CanvasContainer gates the mount behind `session.id !== null && whiteboard !== null` so the snapshot is meaningful.

### `apps/api/src/routes/chat.ts` — cross-turn `tool_result` round-trip is live

Phase 3 closed tech-debt #1. `TranscriptMessage.tools` holds every `tool_use` Claude emitted for an assistant turn; `buildAnthropicMessages` re-emits them and synthesises matching `tool_result` blocks from the client's `pendingToolResults` queue on the next user turn. Anthropic only accepts `tool_result` blocks whose `tool_use_id` refers to a still-attached `tool_use` — so **don't drop `tools` from the persisted transcript**, and **don't strip `tool_use` blocks from the rehydrated assistant content** in `buildAnthropicMessages`. Both will resurrect the orphan-id crash.

### Tool names use underscores

Anthropic's `tools[*].name` regex is `^[a-zA-Z0-9_-]{1,128}$` — no dots. We use `whiteboard_add_element` on the wire even though the vision doc uses `whiteboard.add_element`. Keep this consistent for any new tool family (`map_fly_to`, `web_navigate`, etc.).

### `apps/api/src/routes/chat.ts` — `document_read_page` is server-fulfilled and can be multimodal

Closed in Priority 1a. Seneca reads PDFs directly via the new server-fulfilled `document_read_page` tool. Two paths run inside one resolver in [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts):

1. **Text path** — the agent loop hits [`apps/api/src/lib/documentTextStore.ts`](../apps/api/src/lib/documentTextStore.ts) for per-page text (extracted at upload by [`apps/api/src/lib/pdfTextExtractor.ts`](../apps/api/src/lib/pdfTextExtractor.ts)) and returns a JSON envelope as the `tool_result` content. Cheap.
2. **Visual fallback** — when the page's char count is below `SCANNED_PAGE_CHARS_THRESHOLD`, the resolver renders the page server-side via [`apps/api/src/lib/pdfPageRenderer.ts`](../apps/api/src/lib/pdfPageRenderer.ts) (`pdfjs-dist` + `@napi-rs/canvas`) and returns a *multimodal* tool_result `[{text}, {image:base64}]`. Seneca reads it visually in the same iteration; the user is never asked to enable vision capture.

The `AnthropicToolResultContent` type in `chat.ts` is unioned `string | Array<TextBlock | ImageBlock>` so other future tools can also return multimodal content the same way. **Do not** add a half-measure that scrapes text in the browser and POSTs it to Anthropic in a system message — that bypasses the tool-result protocol the agent loop relies on, and the path above is already complete.

### `apps/api/src/lib/pdfPageRenderer.ts` — globalThis polyfills, do not strip

The page renderer sets `DOMMatrix`, `Path2D`, `ImageData`, and `Image` on `globalThis` exactly once at module load. `pdfjs-dist` v5's legacy build references these as bare identifiers and throws `ReferenceError` deep inside its render path if they're absent. If you ever rework this file, keep the shim block intact, or wrap it in a single `setupPdfJsGlobals()` call before the first import — both work. The shims are no-ops on Workers / other runtimes where these are already globals, so they're safe to leave on.

### `apps/api/src/lib/sessionStore.ts` — interface, not class

Both the in-memory store and the Supabase store implement `SessionStore`. When you add fields to `SessionRecord`, update both implementations and the Supabase SQL schema in `docs/setup.md`. The migration is not yet automated; we're explicit about it because we expect schema churn through Phase 4.

### Theme migrations

Don't reach for raw `ink-*` / `ember-*` Tailwind classes in new components. Use the semantic tokens (`bg-surface`, `text-fg`, etc.). The raw palette stays available for one-off ad-hoc accents but every new surface should switch cleanly between light and dark. If you do need to read a token value from JS (e.g., to colour an SVG that doesn't inherit), read `getComputedStyle(document.documentElement).getPropertyValue('--c-fg')` or expose the token list via a small helper.

### Dev-bypass is local only

`DEV_BYPASS_AUTH=true` skips JWT validation and uses an in-memory session store. **Never enable this on a deployed instance.** The setup doc explicitly says so. Production deploys must set the flag to `false` (or omit it) on both Vercel and Railway.

### Anthropic model access

Vision turns hit `claude-opus-4-7`. Some Anthropic accounts don't have Opus. Failure mode: `403 unauthorized model`. Documented in setup doc; if you change the default vision model, update the troubleshooting block.

### Excalidraw freedraw

We don't render Claude-emitted `freedraw` as an actual freedraw element (it requires pressure-array internals we can't synthesise). We render it as a multi-point line. Visually identical for sketchy diagrams. Don't "fix" this without testing the actual freedraw path end-to-end.

### `pnpm` allowBuilds

The repo's `pnpm-workspace.yaml` whitelists `esbuild` under `allowBuilds`. If a new dependency needs a postinstall script (e.g. `sharp`, `bufferutil`), add it to that block — pnpm 11 will refuse to install otherwise.

### Leaflet default marker icons under Vite

Leaflet's `L.Icon.Default` resolves marker images via paths baked at build time, which Vite doesn't see. We patch this once at module load in [`apps/web/src/components/Canvas/MapTab.tsx`](../apps/web/src/components/Canvas/MapTab.tsx) by importing the three marker assets via `?url` and reassigning `L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl })`. If markers ever start rendering as broken-image icons, that block is the first thing to check.

### Leaflet tile layers must set `crossOrigin: true`

The vision capturer uses `html-to-image` to snapshot the map div. If a tile layer is loaded without `crossOrigin: true`, the resulting canvas is tainted and the export silently returns null. Both tile layers we ship pass that flag (see `TILE_PROVIDERS` in `MapTab.tsx`). When adding a new provider, do the same and verify the host returns `Access-Control-Allow-Origin: *`.

### Leaflet `invalidateSize` after tab switch

The map mounts inside an `invisible` div before the user ever clicks the Map tab. Leaflet measures the container at mount and caches the dimensions; without a follow-up `invalidateSize()` you get tile gaps the first time the user switches in. `MapTab` calls `invalidateSize` whenever the active tab becomes `"map"`. If you ever rework the tab containers, preserve that effect.

### Web proxy SSRF guard

Both [`apps/api/src/lib/webProxy.ts`](../apps/api/src/lib/webProxy.ts) and any tool that fetches arbitrary URLs from user input must refuse private / loopback / link-local IPs. The current guard handles IPv4, IPv6, IPv4-mapped IPv6, and re-validates after redirects. There is a small TOCTOU window between the DNS lookup and the actual `fetch` — for MVP we accept it; a complete fix needs a custom HTTP agent that validates each socket. If you ever swap `node:dns.lookup` for something else, keep the post-redirect re-check.

### Iframe `srcdoc` is same-origin

Critical for two things in [`apps/web/src/components/Canvas/WebTab.tsx`](../apps/web/src/components/Canvas/WebTab.tsx):
1. `html-to-image` can reach into the iframe's `contentDocument` for vision capture (it inherits the parent origin).
2. The `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"` attribute is what makes that work while still containing any leftover scripting.

Don't add `allow-scripts` to the sandbox — the proxy strips JS, but the sandbox is the belt to the proxy's braces. Don't drop `allow-same-origin` either, or capture breaks.

### `pdfjs-dist` version must match `react-pdf`'s bundled copy

react-pdf ships its own pinned `pdfjs-dist` as a hard dependency. We import the worker via `pdfjs-dist/build/pdf.worker.min.mjs?url` (Vite gives us a same-origin asset URL), which only works if our top-level `pdfjs-dist` resolves to the same version react-pdf is using internally. If the versions drift you'll see `The API version "X" does not match the Worker version "Y"` at first parse and no PDF will render. Fix: read `apps/web/node_modules/react-pdf/package.json`'s `dependencies.pdfjs-dist` value and reinstall that exact version with `pnpm --filter @seneca/web add pdfjs-dist@<exact-version>`. Today that's `5.4.296` paired with `react-pdf@10.4.1`.

### Document upload uses raw bytes, not multipart

`POST /api/sessions/:id/documents` accepts a raw body with the original filename in an `X-File-Name` header. We avoid `multer` so there's no extra dependency for one MVP route. The route applies `express.raw({ type: <callback>, limit: '26mb' })` per-route — the callback claims any MIME the extractor registry in [`apps/api/src/lib/documentExtractors/`](../apps/api/src/lib/documentExtractors/) supports, plus the generic `application/octet-stream` fallback. The global `express.json({ limit: "12mb" })` mounted in `server.ts` skips non-JSON bodies, so the two parsers don't collide. If you add a new extractor, register it in [`apps/api/src/lib/documentExtractors/index.ts`](../apps/api/src/lib/documentExtractors/index.ts); both the upload route and the global limit pick it up automatically.

### Document bytes need explicit cleanup on session delete

The `documents` JSONB column lives inside the `sessions` row, so deleting a session removes the metadata. The PDF bytes themselves live in Supabase Storage at `seneca-documents/{userId}/{sessionId}/{docId}.pdf` and **don't** cascade with the row delete. When Phase 4 builds the session-delete UI, the handler must also wipe the `seneca-documents/{userId}/{sessionId}/` prefix or it'll leak storage indefinitely. The dev-bypass `Map<docId, Buffer>` is keyed `{userId}/{sessionId}/{docId}` for the same reason — easy to wipe by prefix.

### Server-fulfilled tools

Most tools follow a one-sided contract: Claude calls them, the client mutates the canvas, the cross-turn `tool_result` round-trip (Phase 3) carries any failure back, and the chip shows the outcome. Five tools today are different — they're *content-returning* (or content-creating) so the `tool_result` body actually matters to the next iteration. The agent loop in [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) resolves them inline and feeds the real content back:

- **`web_read_page`** — `fetchAndSanitise` + `extractTextFromHtml`, JSON envelope with text + url + title.
- **`document_read_page`** — text store lookup with lazy extraction, JSON envelope; falls back to a multimodal `[text, image]` block array for scanned PDFs (the only multimodal tool result we currently emit).
- **`document_list`** — pure projection of `sessionRow.documents` into a JSON envelope `{count, activeId, items[]}`. Constant-time.
- **`document_search`** — cosine top-k via Voyage + pgvector (Priority 1b), with the original substring scan retained as a graceful fallback. Same wire contract; the `engine` field on the envelope tells Seneca which engine ran.
- **`document_create`** — server writes a new markdown doc to `document_pages` + the chunk index, mutates `sessionRow.documents` in-place so chained tools in the same turn see it, and pushes a `documents-updated` SSE event to update the client sidebar mid-turn.

If you add another content-returning tool later, follow the same pattern: branch in the `Promise.all(toolUses.map(...))` block in chat.ts (NOT in the client dispatcher), return the real content, and add a no-op chip branch in the client dispatcher so the user still sees the call. The agent loop also tracks the most recent `web_navigate` URL and the most recent `document_go_to_page` (and `document_create`) doc id within a turn so navigate-then-read and switch-doc-then-read chains work without persisting between turns. See [`docs/actions.md`](actions.md) for the contract.

---

## 6. Quick-start for the next agent

```bash
# 1. Read docs/vision.md and this file (you're here).
# 2. Boot locally:
cp apps/api/.env.example apps/api/.env       # paste Anthropic key
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm dev

# 3. Open http://localhost:5173 — you should land in the app (Dev mode badge in header).
# 4. Try voice, drawing, vision, and asking Seneca to draw. Verify chips + retry work.
# 5. Pick a Priority from §4 above. Stay in a vertical slice.
```

When you finish a piece of work, update §3 (status tracking) in this file and bump the relevant Priority. Don't accumulate unwritten state in your head.

Welcome aboard.
