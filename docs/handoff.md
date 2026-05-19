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
      hooks/        useSpeechRecognition, useSpeech, useVoiceActivity, useConversationVad, useMicAnalyser, usePlaybackAnalyser
      lib/          api, runTurn, actionDispatcher, workspaceContext, whiteboard*, toolResultOutputs
      store/        seneca.ts (Zustand)
      theme/        ThemeProvider, ThemeToggle
  api/              Node + Express + TS
    src/
      lib/          anthropic, supabase, sessionStore (abstraction), sse
      middleware/   auth
      routes/       chat, sessions, health
      server.ts, env.ts, bootstrap.ts
packages/
  shared/           types, prompt, tools, workspaceContext
```

~500+ unit tests across the three workspaces; CI runs `typecheck`, `test`, and `build` on every push and PR.

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
                        │  (+ workspaceContext each turn)        │
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
6. ~~**No tests.**~~ **Closed in Phase 1.** ~500+ unit tests across the three workspaces; CI runs `typecheck`, `test`, and `build` on every push and PR. Run `pnpm test` locally.
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
5. [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) — the agent loop heart of the backend (`buildSystemPrompt` merges `workspaceContext`).
6. [`apps/web/src/lib/workspaceContext.ts`](../apps/web/src/lib/workspaceContext.ts) + [`packages/shared/src/workspaceContext.ts`](../packages/shared/src/workspaceContext.ts) — structured canvas snapshot for vision-off turns.
7. [`apps/web/src/lib/runTurn.ts`](../apps/web/src/lib/runTurn.ts) — the orchestrator on the client.
8. [`apps/web/src/store/seneca.ts`](../apps/web/src/store/seneca.ts) — UI state.
9. [`apps/web/src/components/Canvas/WhiteboardTab.tsx`](../apps/web/src/components/Canvas/WhiteboardTab.tsx) — has load-bearing comments about non-obvious patterns.
10. [`apps/web/src/lib/whiteboardActions.ts`](../apps/web/src/lib/whiteboardActions.ts) + [`apps/web/src/lib/whiteboardScene.ts`](../apps/web/src/lib/whiteboardScene.ts) — placement, measureText sizing, post-placement lint.
11. [`apps/web/src/lib/toolResultOutputs.ts`](../apps/web/src/lib/toolResultOutputs.ts) — structured `ToolResult.output` builders for client tools.
12. [`apps/web/src/components/Canvas/MapTab.tsx`](../apps/web/src/components/Canvas/MapTab.tsx) — same pattern as WhiteboardTab applied to Leaflet; read both side by side when adding the next tab.
13. [`apps/web/src/components/Canvas/WebTab.tsx`](../apps/web/src/components/Canvas/WebTab.tsx) and [`apps/api/src/lib/webProxy.ts`](../apps/api/src/lib/webProxy.ts) — the third instance of the bridge / capturer / debounced-persist pattern, plus a non-trivial server-side proxy with SSRF guard and HTML sanitisation.
14. [`apps/web/src/components/Canvas/DocumentTab.tsx`](../apps/web/src/components/Canvas/DocumentTab.tsx) and [`apps/api/src/routes/documents.ts`](../apps/api/src/routes/documents.ts) — the fourth instance of that same pattern, plus the only tab that round-trips real binary blobs through the API and a separate `documentStorage` abstraction. Read these *before* adding any new tab that needs file storage.
15. [`docs/actions.md`](actions.md) — protocol contract (workspace context + rich tool outputs), useful when adding new tools.
16. [`apps/web/src/hooks/useVoiceActivity.ts`](../apps/web/src/hooks/useVoiceActivity.ts) — zone-based voice activity phases (user / Seneca speaking / Seneca working sub-states); read before changing voice pane indicators or timing.

---

## 3. Vision tracking

### MVP scope (vision §7)

| Requirement | Status | Where |
|---|---|---|
| Single-user email/password auth (Supabase) | ✅ | `auth/AuthProvider.tsx`, `middleware/auth.ts` |
| Dev-bypass mode | ✅ extra | `lib/devBypass.ts`, `lib/sessionStore.ts` |
| Persistent session list (create, name, resume, delete) | ✅ | `apps/api/src/routes/sessions.ts`, `apps/web/src/components/Sessions/SessionsModal.tsx` |
| Voice pane (STT, TTS, transcript, mute/pause, vision toggle, zone activity visuals) | ✅ | `components/VoicePane/*`, `hooks/useVoiceActivity`, `hooks/use*` |
| Text input fallback | ✅ | inside `VoicePane.tsx` |
| Whiteboard tab | ✅ | `components/Canvas/WhiteboardTab.tsx` |
| Diagrams tab (draw.io embed) | ✅ | `components/Canvas/DiagramsTab.tsx`, `lib/diagramBridge.ts`, `lib/diagramActions.ts`, `packages/shared/src/diagramGraph.ts` |
| Document tab (PDF upload + viewing) | ✅ | `components/Canvas/DocumentTab.tsx`, `lib/documentActions.ts`, `lib/documentBridge.ts`, `apps/api/src/routes/documents.ts`, `apps/api/src/lib/documentStorage.ts` |
| Web tab (URL input + sanitised proxy) | ✅ | `components/Canvas/WebTab.tsx`, `lib/webActions.ts`, `lib/webBridge.ts`, `apps/api/src/routes/web.ts` |
| Map tab (Leaflet, layers, AI pins/fly-to) | ✅ | `components/Canvas/MapTab.tsx`, `lib/mapActions.ts`, `lib/mapBridge.ts` |
| Vision toggle (capture active canvas → Claude) | ✅ | `components/VoicePane/VisionToggle.tsx`, `lib/captureCanvas.ts` |
| Environment intelligence (`workspaceContext` + rich tool outputs) | ✅ extra | `lib/workspaceContext.ts`, `packages/shared/src/workspaceContext.ts`, `lib/whiteboardScene.ts`, `lib/toolResultOutputs.ts`, `lib/persistActiveTab.ts` |
| AI action execution (whiteboard) | ✅ | server agent loop + `lib/actionDispatcher.ts` |
| AI action execution (map) | ✅ | `lib/mapActions.ts` (fly-to, drop pin, draw shape, set layer) |
| AI action execution (web) | ✅ | `lib/webActions.ts` (navigate, search) |
| AI action execution (document) | ✅ | `lib/documentActions.ts` (`document_go_to_page`), `apps/api/src/routes/chat.ts` (`document_read_page` server-fulfilled with scanned-PDF visual fallback; `document_list` and `document_search` server-fulfilled so Seneca can introspect and find phrases without a sidebar peek) |
| AI action execution (diagrams) | ✅ | Client: `diagram_load`, `diagram_merge`, `diagram_clear`, `diagram_set_label`, `diagram_remove_cells`, `diagram_add_nodes`, `diagram_layout` with live `getLiveXml()` + `DiagramToolResult` diff/warnings. Server: `diagram_read` via `apps/api/src/lib/diagramRead.ts` on persisted `session.diagrams.xml`. Workspace context includes vertex/edge digest when diagrams have content. |
| AI action execution (tab.switch) | 🟡 | Implicit auto-switching already happens in dispatcher; explicit `tab_switch` tool intentionally deferred |
| AI-authored documents (`document_create`) | ✅ extra | `apps/api/src/routes/chat.ts` (`resolveDocumentCreate`), `packages/shared/src/tools.ts` |
| Multi-format document support (.docx, .pptx, .md, .txt, .html) | ✅ | `apps/api/src/lib/documentExtractors/`, `apps/web/src/components/Canvas/MarkdownViewer.tsx` |
| Cost telemetry (per-turn + per-session) | ✅ extra | `apps/api/src/lib/pricing.ts`, `apps/web/src/components/CostPill.tsx` |

### Acceptance criteria (vision §8)

Per-section detail; tick when every subcriterion passes.

- **§8.1 Auth & Session Management** — ✓. Auth ✓. Session list ✓ (`SessionsModal` with create / rename / delete + cascade cleanup of document text / chunks / bytes / storage prefix). Persistence across logout ✓ in real-auth mode.
- **§8.2 Voice Pane** — ✓ all bullets.
- **§8.3 Vision Toggle** — ✓ all bullets. Capture works for whiteboard and map; doc / web tabs land with their respective slices. When vision is off, `<workspace_context>` in the system prompt supplies structured canvas state (see Phase H below).
- **§8.4 Whiteboard Tab** — ✓ all bullets except: AI free-draw renders as multi-point line (deliberate; documented).
- **§8.5 Document Tab** — ✓. PDF + `.docx` + `.pptx` + `.md` / `.markdown` / `.txt` + `.html` / `.htm` upload through the extractor registry (drag-drop + file picker, ≤25 MB, magic-byte + mime + extension dispatch). Multi-document sidebar with click-to-switch, inline confirm-on-delete, text-status + index-status pills, and a "✦" badge on AI-authored docs. PDFs render through react-pdf with prev / next / jump / page-of-N; markdown / docx / pptx / html render through the themed `MarkdownViewer`. Files in Supabase Storage (private `seneca-documents` bucket) in real-auth mode, a process-local `Map<docId, Buffer>` in dev-bypass; AI-authored markdown lives inline in `document_pages` with no Storage blob. **Seneca can read every format directly** via `document_read_page` (born-digital text path + scanned-PDF visual fallback). **Seneca knows what's loaded** via `document_list`, and **finds phrases semantically** via `document_search` (cosine top-k over Voyage embeddings + pgvector, substring fallback). **Seneca can also write new docs** via `document_create` — markdown stays inline, the SSE `documents-updated` event makes the sidebar update mid-turn.
- **§8.6 Web Tab** — ✓ all bullets. URL bar + back/forward/reload + sanitised proxy + AI navigate + AI search with clickable card list.
- **§8.7 Map Tab** — ✓ all bullets. Leaflet renders fullscreen; standard + satellite tile layers; user draws via leaflet-draw; AI flies, pins, draws via `map_*` tools; layer toggle in the corner; state persists.
- **§8.8 AI Action Execution** — ✓. Schema ✓ for whiteboard + map + web + documents. Streaming dispatch ✓. Auto-tab-switch ✓. Failure-feedback round-trip ✓ (Phase 3). Structured success feedback ✓ (Phase H — `ToolResult.output` on the next turn for whiteboard placement, web search, map mutations, document navigation).
- **§8.9 Tab System** — ✓ all four tabs (whiteboard, map, web, documents) functional. Explicit `tab_switch` tool deferred — auto-switch already happens whenever a tool fires for a non-active tab.
- **§8.10 Session Persistence** — ✓. Whiteboard scene, map state, web URL+history, documents metadata + active doc + per-doc current page, last focused tab (`active_tab`, Phase H), transcript text + persisted `tool_use` records (Phase 3), and rolling per-session cost totals (Phase 4) all persist. PDF bytes persist in Supabase Storage (real-auth) or in-process Map (dev-bypass). AI-authored markdown persists inline in `document_pages` with no Storage blob.

### Open questions (vision §11)

| # | Question | Resolution |
|---|---|---|
| 11.1 | Tool-use API vs XML | ✅ Tool-use API (Anthropic). Decision documented in [`actions.md`](actions.md). |
| 11.2 | Whiteboard scene-JSON vs PNG for vision | 🟡 Vision still ships PNG for the active tab. Phase H added a **compact scene digest** (≤20 elements + viewport bounds) inside `<workspace_context>` when vision is off — cheaper than full scene JSON, good enough for placement and "what's on the board" questions. Full scene-JSON-as-vision-input experiment still deferred. |
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

Every MVP priority (1a / 1b / 1c / 1d / 2 / 3 / 4) and every closeable tech-debt item (#1, #2, #3, #4, #5, #6, #7, #8, #9, #10) have shipped. The next planned work is a **pre-production UX polish phase** — six phased slices captured in [`docs/ux_polish_roadmap.md`](ux_polish_roadmap.md). Together they take Seneca from "MVP feature-complete" to "ready for a public pilot."

> **Active roadmap: Pre-prod UX polish** (Phases A–H). Phases in order:
> - ✅ **A — Vision lock & clearer affordance**: three-state segmented control (Off / Once / Locked) shipped in `apps/web/src/components/VoicePane/VisionToggle.tsx`, persisted `visionDefault` preference in `apps/web/src/lib/userPreferences.ts` (off / once / locked), `loadSession` seeds the eye from the preference, Settings → Appearance → "Vision default" exposes it, and the active canvas tab shows a small "1×" / "Locked" badge whenever vision is on. The system prompt now tells Seneca to ask the user to *lock the eye* rather than the old shift-click language. Tests cover the three state transitions (`setVisionMode`), the segmented control's keyboard navigation, the `loadSession` seeding behaviour, and `userPreferences.merge` validation of the new field.
> - ✅ **B — Live STT into the input box + VAD**: `useSpeechRecognition` ([`apps/web/src/hooks/useSpeechRecognition.ts`](../apps/web/src/hooks/useSpeechRecognition.ts)) gained `onInterim` / `onSilence` callbacks and a configurable silence window (default 1500ms). The dictation surface in [`DictationField.tsx`](../apps/web/src/components/VoicePane/DictationField.tsx) renders the live interim transcript as ghost text positioned exactly where the cursor sits (controlled textarea + a sibling overlay using an invisible mirror span). Three input behaviours: **edit-before-send** (default — finals stream into the textarea for review), **hands-free + VAD** (finals accumulate, the silence callback submits after ~1.5s of quiet), **hands-free without VAD** (each final auto-submits — today's behaviour). A new [`useMicAnalyser`](../apps/web/src/hooks/useMicAnalyser.ts) hook + [`Waveform.tsx`](../apps/web/src/components/VoicePane/Waveform.tsx) component feed the AnalyserNode into a 7-bar canvas indicator that lives next to the push-to-talk button and tears down its AudioContext + MediaStream on unmount. A global keyboard shortcut hooks the configured PTT key (default Space) — disabled while an editable input is focused, suppresses repeats, releases on `blur`. Three new preferences: `editBeforeSend` (default `true`), `vadEnabled` (default `true`), `pttKey` (default `" "`), exposed in Settings → Voice & Audio via a recording-style picker. Tests cover silence-detection debounce, interim accumulation, edit-before-send keyboard flow, the ghost-text overlay layout, and `useMicAnalyser` cleanup discipline (track stops + AudioContext close on every active flip and on unmount).
> - ✅ **C — Premium TTS via ElevenLabs**: new `apps/api/src/lib/elevenLabsTTS.ts` thin client streams audio via `POST /v1/text-to-speech/{voiceId}/stream` with typed `TTSError` (`unconfigured` / `rate_limited` / `voice_not_found` / `upstream_failed`). Exposed via `POST /api/tts` (auth-gated, 4_000-char cap, streams audio bytes straight through, debits `sessionStore.bumpUsage` with `ttsCharacters` + `ttsCostUSD` after each successful synth) and a tiny unauthenticated `GET /api/tts/config` the client probes on mount. Six curated voices (Brian, Adam, George, Sarah, Rachel, Josh) baked into `CURATED_VOICES`. New web hook `useElevenLabsSpeech` mirrors the `SpeechSynthesisHook` interface and plays audio through a hidden `<audio>` element with a queue + URL-revoke discipline; per-utterance abort lets `skip()` interrupt mid-stream. A unified `useSpeech` facade routes between premium and browser engines based on the config probe + the new `ttsProvider` preference (default `"auto"`). Speech-interruption: when STT starts listening mid-playback we pause TTS, resume on stop. Voice picker in Settings → Voice & Audio includes a 3-second preview button per voice, a "Voice engine" radio (Premium auto / Browser only), and the legacy browser-voice select rebrands as "Fallback voice". CostPill tooltip now surfaces `TTS: N chars · $X (ElevenLabs)` alongside Anthropic spend. New env vars (`ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, `ELEVENLABS_MODEL_ID`) documented in `docs/setup.md` §2.7 and `apps/api/.env.example`. Tests cover the ElevenLabs HTTP boundary (success, 404, 429, 500), the `/api/tts/config` and `/api/tts` route behaviour (including 413 / 400 / unconfigured 503), the engine-selection facade with `provider=auto` and `provider=browser`, and the `fetchTtsConfig` caching layer.
> - ✅ **D — Session UX: previews, search, pinning, export, resume hint**: `SessionSummary` (shared interface in [`apps/api/src/lib/sessionStore.ts`](../apps/api/src/lib/sessionStore.ts) and [`apps/web/src/lib/sessions.ts`](../apps/web/src/lib/sessions.ts)) now carries `pinned`, `lastMessageAt`, `lastUserText`, `documentCount`, and `tabs`. The new `summarizeSession(row)` helper centralises the derivation (last user message snippet collapsed + truncated to 140 chars on a word boundary, tab flags from `documents.items.length > 0`, `web.url`, `map.pins/shapes`, `whiteboard.elements`). Supabase store list query gained a wider projection (`transcript, documents, web, map, whiteboard`) so the cards render real previews — with a "column does not exist" fallback for pre-migration deployments that haven't run the new `pinned` ALTER. Server-side `setPinned` + a partial-update `PATCH /api/sessions/:id` accepting `{ name, pinned }` round-trip the star without affecting `updated_at` (pinning isn't activity). [`SessionsModal`](../apps/web/src/components/Sessions/SessionsModal.tsx) was redesigned: search input filters by name + snippet text, preview cards show snippet / doc count / tab chips, an inline star toggles pin with optimistic UI, and a download icon exports a markdown transcript via [`apps/web/src/lib/sessionExport.ts`](../apps/web/src/lib/sessionExport.ts) (`buildSessionMarkdown` + `sessionFilename`). Resume hint: [`ResumeBanner.tsx`](../apps/web/src/components/VoicePane/ResumeBanner.tsx) sits at the top of the transcript scroller, reads `documentsState` + the last user turn, and recaps "Welcome back to {session}. {Doc} is open on page N of M · Last asked: …" Self-dismisses on the next `appendTranscript`, has an explicit ✕ button, and never shows for empty sessions. Migration documented in `docs/setup.md` §3.1 + §3.4 (`pinned boolean not null default false`). Tests: 6 new `summarizeSession` cases (empty, last-user-pick, snippet truncation, tab fan-out, whitespace collapse, blank-user-skip), 4 new memory-store list/pin tests, 8 markdown-export tests, 5 resume-banner store-reducer tests, and 5 SessionsModal UI tests (cards, search filter by both axes, pin toggle, download click-through, empty state).
> - ✅ **E — Hybrid web rendering via headless Chromium**: new [`apps/api/src/lib/headlessRender.ts`](../apps/api/src/lib/headlessRender.ts) lazy-loads `playwright-core` via a variable specifier (`const s = "playwright-core"; await import(s)`) so the typechecker doesn't demand it and the bundle never errors when the optional dep is missing. Singleton `chromium.launch()`, concurrency-gated at 2 contexts (in-process semaphore + wait queue), 8s networkidle timeout, 30s hard-kill timer that always releases the slot in `finally`, viewport 1280×800. Browser-side extraction (anchor bboxes + densest-text-block reader) lives in a string-literal evaluated via `page.evaluate` so the Node-only API project doesn't need the DOM lib. `looksLikeSpaShell` heuristic (visible-text < ~150 chars + ≥ 3 script tags, framework hooks like `__next` / `data-reactroot` / `ng-app`, or script-to-text ratio > 50 chars per script). New [`apps/api/src/lib/headlessRateLimit.ts`](../apps/api/src/lib/headlessRateLimit.ts) — sliding-window per-session limiter (30 / hour, configurable), `tryClaim` returns structured `{ ok, retryAfterSec, used, budget }`, `peek` is non-mutating. New routes in [`apps/api/src/routes/web.ts`](../apps/api/src/routes/web.ts): `GET /api/web/render/config` (unauthenticated capability probe) and `POST /api/web/render` (auth-gated hybrid resolver). The resolver tries static first via `fetchAndSanitise`, runs the SPA heuristic on the sanitised body, falls back to headless when warranted, and gracefully degrades back to the static result if the headless render throws (with `headlessError` in the response so the client can render a "(degraded)" badge). New [`assertSafeUrl`](../apps/api/src/lib/webProxy.ts) export reuses the existing SSRF guard before opening any URL in Chromium. Web tab: refactored [`WebTab.tsx`](../apps/web/src/components/Canvas/WebTab.tsx) to call the new `/api/web/render` and branch on `engine`. Static engine still uses the sandboxed iframe; headless engine renders the screenshot via new [`WebHeadlessView.tsx`](../apps/web/src/components/Canvas/WebHeadlessView.tsx) with absolutely-positioned, invisible link buttons whose bbox coordinates are scaled from the server viewport to the displayed image size (ResizeObserver-backed). Reader/Live toggle in the footer flips to [`WebReaderView.tsx`](../apps/web/src/components/Canvas/WebReaderView.tsx) for a clean text-only view. Footer pill shows "Live N/30" budget when headless ran; tone goes amber at 80% and danger at 100%. Capability probe via [`apps/web/src/lib/webRender.ts`](../apps/web/src/lib/webRender.ts)'s `fetchRenderConfig` (cached in-module) hides the Reader toggle entirely when Playwright isn't installed. Optional dep documented in `docs/setup.md` §2.8 (sign up… no wait, `pnpm add playwright-core` + `playwright install chromium`, restart). Tests: 5 `looksLikeSpaShell` cases on real-shaped fixtures, `isHeadlessAvailable` returns false when the package is absent, `HeadlessRenderError` shape; 6 rate-limit cases (claim, exhaust + retry-after, isolation, window-recovery via `vi.useFakeTimers`, peek is non-mutating, unknown bucket); 9 route-level cases (config probe true/false, static for content-rich, headless fallback on SPA shell, degraded fallback when headless throws, 429 budget-exhaustion with Retry-After, forceEngine bypass, non-html 4xx surface, 400 on missing url). `fetchAndSanitise` is stubbed at the `webProxy` module boundary so the test client's own fetch doesn't get intercepted.
> - ✅ **F — Pre-deploy hardening + polish**: shipped as four logical slices.
>   - **F.1 — Rate limits + daily cost cap.** New [`apps/api/src/middleware/rateLimit.ts`](../apps/api/src/middleware/rateLimit.ts) sliding-window limiter, applied with route-specific multipliers (chat × 1, vision × 1, tts × 2, render × 0.5) on top of the base `RATE_LIMIT_TURNS_PER_HOUR` env (default 60). On exhaustion: 429 + `Retry-After`, structured `{ code: "rate_limited", used, budget, retryAfterSec }`. Set the env to 0 to disable (used by tests). New [`apps/api/src/lib/costCap.ts`](../apps/api/src/lib/costCap.ts) per-user per-UTC-day USD accumulator — `assertWithinDailyCap` runs at the very start of every `/api/chat` and `/api/vision` turn and `recordDailyCost` debits the bucket after each Anthropic usage event. Exhaustion returns 403 + `code: "cost_capped"` with `used`, `cap`, `resetInSec`. Both surfaces are documented in `apps/api/.env.example` (`RATE_LIMIT_TURNS_PER_HOUR`, `COST_CAP_USD_PER_DAY`) and `friendlyMessage` in `apps/web/src/lib/runTurn.ts` now translates those codes into user-readable transcript notices. Tests: 3 middleware cases (allow, exhaust → 429, no-op at 0), 7 cost-cap cases (peek baseline, accumulator, exceed transition, disabled cap, assert no-op, assert throw with tagged error, ignore non-positive deltas).
>   - **F.2 — Structured logging + request IDs + readiness probe.** Replaced `morgan("dev")` with a tiny in-house JSON-line logger in [`apps/api/src/lib/logger.ts`](../apps/api/src/lib/logger.ts) — honours `LOG_LEVEL` (debug / info / warn / error), supports `child()` contexts, redacts shape-detected secrets (`email`, `jwt`, anything matching `/token|secret|authorization|password/i`). New [`apps/api/src/middleware/requestId.ts`](../apps/api/src/middleware/requestId.ts) stamps every request with a UUID (honours an inbound `X-Request-Id` if a reverse proxy sets one), attaches a `req.log` child logger, and exposes the ID back to the client via the `X-Request-Id` response header (also added to CORS `exposedHeaders`). New `GET /api/ready` in [`apps/api/src/routes/health.ts`](../apps/api/src/routes/health.ts) returns 200/503 + a checks object (`anthropic`, `supabase`, `voyage`, `tavily`, `elevenlabs`, `mode`) without making outbound calls — keeps the probe cheap so deploy platforms can hammer it on a tight loop. Server `app.use` is rewired to do one info-level "request" log per request with `method / path / status / durationMs`, errors with stack to stderr. Dropped the `morgan` + `@types/morgan` deps from `apps/api/package.json`. Tests: 3 logger redaction cases (key matchers, nested + arrays, primitives), 3 health-route cases (`/api/health` + request ID header echo + `/api/ready` dev-bypass).
>   - **F.3 — Toast notifications + keyboard shortcut overlay.** New [`apps/web/src/components/Toast/toastStore.ts`](../apps/web/src/components/Toast/toastStore.ts) is a tiny pub/sub (independent of Zustand so non-React modules can raise toasts) with `info / success / warn / error`, optional descriptions, optional action buttons, and `durationMs: null` for sticky toasts. Paired with [`ToastViewport.tsx`](../apps/web/src/components/Toast/ToastViewport.tsx), a fixed top-right column with `role="status"` and `aria-live` per-toast (errors → assertive). Wired into the sessions modal (export success / failure, delete confirmation). New [`apps/web/src/components/KeyboardShortcuts/ShortcutOverlay.tsx`](../apps/web/src/components/KeyboardShortcuts/ShortcutOverlay.tsx) is a Cmd/Ctrl+/ modal listing every shortcut Seneca offers, grouped by area (Global / Sessions / Voice & Vision / Canvas). Escape closes. Mounted globally in `App.tsx`. New CSS keyframes (`toast-enter`, `overlay-fade-in`) in `src/index.css` keep the animations CSS-only (no `tailwindcss-animate`). Tests: 7 toast-store cases (push + emit, object input, auto-dismiss, sticky `null`, dismiss, clear, subscribe-replay) and 5 overlay cases (closed by default, Ctrl+/ open, Cmd+/ open, Escape close, toggle on second press, renders at least one group).
>   - **F.4 — Login polish + Privacy / Terms + onboarding hint + a11y spot-fixes.** [`LoginPage.tsx`](../apps/web/src/auth/LoginPage.tsx) now has a tablist `role` / `aria-selected` on the Sign-in / Sign-up switch, password hint with `aria-describedby`, `aria-invalid` on inputs while an error is showing, an `aria-busy` submit button, and a short description below the form linking to `#privacy` and `#terms`. New [`apps/web/src/components/Legal/LegalPage.tsx`](../apps/web/src/components/Legal/LegalPage.tsx) renders Privacy and Terms placeholders, hash-routed (`#privacy` / `#terms`) so they work whether or not the user is signed in (the router lives in `App.tsx` outside the auth gate). New [`OnboardingHint.tsx`](../apps/web/src/components/Onboarding/OnboardingHint.tsx) — one-time bottom-right hint with the four headline interactions (Space to talk, eye affordance, drag PDFs / URLs, ⌘/ overlay) gated on a new `onboardingDismissed` preference. AppShell touched up with `aria-label` on the session switcher and `role="status"` + `aria-live` on the API connectivity badge. Tests: 3 LegalPage cases (privacy renders Anthropic mention, terms renders MIT mention, back link), 3 onboarding cases (shows on first run, hides on dismiss + writes the pref, never shows when pref is already set), 1 new `onboardingDismissed` field validated by the existing `userPreferences.merge` tests.
>   - **F follow-up — Tandem voice + echo-suppression.** Two issues observed in real use after the true-barge-in slice landed: Seneca's own TTS output was being picked up by the mic in continuous mode (Chrome's Web Speech Recognition has no AEC layer we can install), and the voice for an initial response was held until *after* all tool calls finished, creating a noticeable gap. The echo fix is a single gate effect in [`VoicePane.tsx`](../apps/web/src/components/VoicePane/VoicePane.tsx) — the recognizer is only set continuous when `continuousListening && !tts.speaking`, so the mic auto-pauses while Seneca talks and resumes when he's done. The user still interrupts via push-to-talk, mic button, or typing. The tandem fix replaces the one-shot `onSpoken(fullText)` at end-of-turn with a sentence-streaming chunker in new [`apps/web/src/lib/sentenceStream.ts`](../apps/web/src/lib/sentenceStream.ts) — `createStreamingChunker()` consumes every text delta, emits sentence-sized chunks at `[.!?]+\s+` / `\n{2,}` boundaries (with a 320-char soft cap for outliers), and is wired into [`runTurn.ts`](../apps/web/src/lib/runTurn.ts) so `onSpoken` now fires per-sentence. The audio queue in [`useElevenLabsSpeech`](../apps/web/src/hooks/useElevenLabsSpeech.ts) plays each chunk in order; tool calls that fire between text bursts no longer block playback. On barge-in the chunker is reset so we don't speak a half-buffered sentence after `tts.clear()`. The system prompt gained a "Tandem discipline" section nudging Seneca to announce tools before calling them (so the audio leads, the canvas updates beside it). Tests: 13 sentence-streamer cases (boundaries, paragraph breaks, closing-quote handling, soft-cap force-flush, stateful chunker push/flush/reset), 3 new tandem `runTurn` cases (per-sentence onSpoken, continues after tool calls between bursts, regression guard against double-speaking the final text).
> - ✅ **G — Conversation Mode (hands-free with Silero VAD).** Real "talk freely, Seneca yields the moment you do" experience, the same recipe production voice agents (OpenAI Realtime, ElevenLabs Conversational AI, Say-Pi) ship. Browser Web Speech Recognition can't tell when the user is *actually* talking (it just transcribes whatever it hears, including TTS leakage), so the entire previous barge-in + turn-end story rested on a "is the interim text growing?" heuristic that mis-fired constantly. Phase G adds a *real* VAD running independently of the recognizer: new [`apps/web/src/hooks/useConversationVad.ts`](../apps/web/src/hooks/useConversationVad.ts) wraps `MicVAD` from [`@ricky0123/vad-web`](https://docs.vad.ricky0123.com/) (Silero V5 model via ONNX Runtime Web, ~5 MB lazy-loaded on first toggle). Surfaces `onSpeechStart` / `onSpeechEnd` / `onVadMisfire` callbacks, `isReady` / `isSpeaking` state, and `setActivationThreshold` for dynamically raising the bar during TTS playback. New asset-path helper [`apps/web/src/lib/vadAssets.ts`](../apps/web/src/lib/vadAssets.ts) defaults to pinned jsDelivr URLs (zero-install) but honours `VITE_VAD_BASE_PATH` / `VITE_VAD_ONNX_WASM_PATH` for self-hosting (CSP-heavy or air-gapped deploys). New preference fields `conversationMode` and `conversationModeHintDismissed` (both default `false`) on the prefs store; round-trip validated. `VoicePane` integration: when `conversationMode` is on, (1) the VAD starts on mount with a graceful auto-disable-and-toast on init failure, (2) speech-start during TTS or an active turn triggers the existing `abortActiveTurn()` + `tts.clear()` barge-in, (3) speech-end debounces 280 ms (waits for recognizer tail), then submits whatever the recognizer accumulated in the textarea, (4) misfires drop any pending submission, (5) during TTS playback the positive threshold is raised from 0.5 → 0.72 so faint echo leakage doesn't false-trigger. The legacy interim-text barge-in stays as a fallback for users on the old continuous toggle. Push-to-talk, "Continuous", and "Hands-free" become disabled in the floating dock while Conversation Mode is on (the VAD owns the recognizer). The dock got a new prominent button — [`FloatingVoiceDock.tsx`](../apps/web/src/components/VoicePane/FloatingVoiceDock.tsx) renders a `ConvoIcon` with three visual states (off / ready / VAD-speaking) so the user always sees what the mic is doing. New [`ConversationHint.tsx`](../apps/web/src/components/VoicePane/ConversationHint.tsx) — one-time floating callout next to the dock that explains the new mode with "Turn on" / "Not now" buttons, gated on the new `conversationModeHintDismissed` pref. New global single-letter shortcut: `C` (no modifiers, ignored when an editable element is focused, ignored when any modifier is held to preserve Cmd+C copy) toggles Conversation Mode and surfaces a small confirmation toast. Lives in [`GlobalShortcuts.tsx`](../apps/web/src/components/KeyboardShortcuts/GlobalShortcuts.tsx), mounted inside the auth gate in `App.tsx`. Updated [`ShortcutOverlay`](../apps/web/src/components/KeyboardShortcuts/ShortcutOverlay.tsx) to list the new shortcut. New Settings → Voice & Audio section explains the mode and exposes the toggle, with the legacy "Default input mode" group dimmed when Conversation Mode is on. Tests: 6 VAD-hook lifecycle cases (start fires callbacks, init failure path, misfire propagation, stop tears down, threshold update, unmount cleanup), 7 conversation-loop integration cases via a harness component (starts VAD on toggle, submits on speech-end with debounce, barge-in on TTS playback, no-op when nothing is playing, cancels pending submit if speech restarts, misfire clears the timer, tears down on toggle-off), 5 global-shortcut cases (toggles on/off, ignored in editable input, ignored with modifiers, ignored on key repeat), 3 prefs round-trip cases. Setup docs got `docs/setup.md §2.10` for the optional self-host story.
> - ✅ **H — Environment intelligence (vision-off context + rich tool feedback).** Seneca now reasons about the canvas without pixels when the eye is off — and gets measurable feedback after whiteboard placements. Every `/api/chat` and `/api/vision` turn carries `workspaceContext` from [`apps/web/src/lib/workspaceContext.ts`](../apps/web/src/lib/workspaceContext.ts), formatted by [`packages/shared/src/workspaceContext.ts`](../packages/shared/src/workspaceContext.ts) and merged in `buildSystemPrompt`. Includes: active tab (persisted via debounced `PUT /api/sessions/:id/active-tab`), vision mode, UI theme, whiteboard background + recommended stroke + viewport bounds + element digest (≤20), map centre/layer/pin labels, document text/index status, web URL + search-overlay flag, voice mode/mute, and `visionCaptureFailed` when capture fails despite the eye being on. **Whiteboard placement:** [`whiteboardActions.ts`](../apps/web/src/lib/whiteboardActions.ts) awaits `document.fonts.ready`, estimates text width via canvas `measureText` (Virgil + emoji margin in [`whiteboardScene.ts`](../apps/web/src/lib/whiteboardScene.ts)), auto-widens after Excalidraw placement, and returns `WhiteboardPlacementResult` with optional layout `warnings`. **Rich cross-turn outputs:** [`toolResultOutputs.ts`](../apps/web/src/lib/toolResultOutputs.ts) builds structured `ToolResult.output` for `web_search`, map tools, `document_go_to_page`, and whiteboard adds — drained on the next turn alongside errors. **Bug fix:** `buildWorkspaceContext` had been reading wrong Zustand keys (`state.map` vs `mapState`, etc.); fixed with unit test. **Same-turn limitation (documented):** within one agent-loop iteration client tools still get synthetic `"ok"`; rich `output` is for the *following* user message. Schema: `sessions.active_tab` — migration in `docs/setup.md` §3.1. Tests: `workspaceContext.test.ts`, `whiteboardScene.test.ts`, `whiteboardActions.test.ts`, shared formatter tests. See [`docs/actions.md`](actions.md) § Workspace context.
>
> See `docs/ux_polish_roadmap.md` for the full plan with file lists, exit criteria, and cross-cutting rules.
>
> - **Zone-based voice activity visuals** (post–Phase H polish): directional activity indicators for user input, Seneca speaking, and Seneca “still working” (thinking / writing / tools). Shipped as a vertical slice on top of Phases B, C, and G — **timing / sequencing first pass closed** (see §4.1); optional polish remains for tool-gap flicker and streaming TTS latency.

After UX polish lands, the original deferred backlog from the seven-phase roadmap stays in place — mostly items that are gated on real usage data:

1. **OCR upgrade for scanned PDFs** (tech-debt #11 / vision §11.C) — pursue when usage data shows scanned-PDF reads eating the cost budget.
2. **`document_edit` collaborative editing** (Priority 1d stretch) — large UX project (Monaco / block editor + diff UI).
3. **PDF export of AI-authored docs** (vision §11.D) — wait for a real user request.
4. **Mobile-optimised layout** (vision §10 Phase 5) — desktop-first by design; tackle after the UX polish phase plus a few weeks of dogfooding.
5. **Multi-persona switching** (vision §11.5) — explicitly post-MVP.
6. **`tab_switch` explicit tool** — auto-switch already happens whenever a tool fires on a non-active tab; add only if Seneca needs to switch *without* mutating that tab.
7. **Long-term cross-session memory** — RAG-over-sessions; revisit when usage shows users returning to the same topic.

### §4.1 — Voice timing & sequencing ✅ closed (first pass)

**Context.** Phase I added a unified activity layer so the voice pane, collapsed strip, and floating dock can show *who* is active (user vs Seneca) and *what kind* of work Seneca is doing (thinking / writing / tools / speaking). The visuals read from `useVoiceActivity` / `useVoiceActivityFromStore`; they do **not** drive turn boundaries or TTS scheduling.

**What was fixed (May 2026):**

| Area | Change | Files |
|---|---|---|
| Phase vs audio | `useSpeech` now exposes `audioActive` (queued + fetching + playing). Activity visuals, echo gate, and VAD threshold key off `audioActive` instead of audible `speaking` alone — ElevenLabs no longer shows "writing" while the first sentence is fetching. | `useElevenLabsSpeech.ts`, `useSpeech.ts`, `VoicePane.tsx`, `useVoiceActivity.ts` |
| Tool gaps | Phase priority prefers `senecaTooling` over `senecaStreaming` when tools are in flight, so the beacon stays on "using tools" during interleaved canvas work. | `useVoiceActivity.ts` |
| VAD submit delay | Conversation Mode submit waits 280 ms tail **then** polls until STT interim is empty (≤800 ms cap) before calling `submitText`. | `conversationSubmit.ts`, `VoicePane.tsx` |
| Status pill / workspace context | `setVoiceMode` now maps active turn → `"thinking"`, TTS pipeline → `"speaking"`, VAD/PTT → `"listening"`. Shared `WorkspaceVoiceContext.mode` extended. | `VoicePane.tsx`, `seneca.ts`, `packages/shared/src/types.ts` |
| Barge-in / echo gate | Barge-in and continuous-listening gate use `tts.audioActive` so fetch-in-flight is treated like playback. | `VoicePane.tsx` |
| Client streaming TTS | Browser plays `/api/tts` progressively via MediaSource (`streamTtsPlayback.ts`); blob fallback when MSE unsupported. Server pump respects write backpressure. | `streamTtsPlayback.ts`, `useElevenLabsSpeech.ts`, `apps/api/src/routes/tts.ts` |
| Header voice pill | `VoiceStatusPill` in AppShell (dot on mobile, label from `sm+`); `voice.activityPhase` / `activityLabel` synced from `VoicePane`. | `VoiceStatusPill.tsx`, `seneca.ts`, `AppShell.tsx` |
| Tests | VAD submit timing; activity phase; stream playback mocks; voice pill + store. | `conversationSubmit.test.ts`, `streamTtsPlayback.test.ts`, `VoiceStatusPill.test.ts` |

**Still open (optional / future):**

- ElevenLabs WebSocket streaming (marginal TTFB gain over MSE; adds connection state on the API tier).
- Redis-backed rate limits when running multiple API replicas (in-process limiter today).
- Richer `workspaceContext` voice field using full `activityPhase` (today uses simplified `voice.mode`).

**Key files (maintenance reference):**

1. [`apps/web/src/hooks/useVoiceActivity.ts`](../apps/web/src/hooks/useVoiceActivity.ts) — phase priority; pass `tts.audioActive` as `ttsSpeaking` from `VoicePane`.
2. [`apps/web/src/components/VoicePane/VoicePane.tsx`](../apps/web/src/components/VoicePane/VoicePane.tsx) — activity wiring, `setVoiceMode`, `setVoiceActivity`, Conversation Mode VAD submit.
3. [`apps/web/src/hooks/useElevenLabsSpeech.ts`](../apps/web/src/hooks/useElevenLabsSpeech.ts) — queue + [`streamTtsPlayback.ts`](../apps/web/src/lib/streamTtsPlayback.ts) progressive playback.
4. [`apps/web/src/components/VoiceStatusPill.tsx`](../apps/web/src/components/VoiceStatusPill.tsx) — header activity affordance.
5. [`apps/web/src/lib/runTurn.ts`](../apps/web/src/lib/runTurn.ts) — tandem sentence chunker + barge-in abort.

**Preference:** `voiceVisualEffects` (default `true`) in [`userPreferences.ts`](../apps/web/src/lib/userPreferences.ts); toggle in Settings → Voice & Audio → “Activity visuals”. Fancy motion is also suppressed when `prefers-reduced-motion: reduce` (`useReducedMotion`).

**Manual QA checklist (Phase I)** — run with Activity visuals **on**, then **off**, then with OS reduced motion:

- Expanded: PTT hold → user bars on right rail; release → stop.
- Conversation Mode: user zone active on VAD speech without STT `isListening`.
- Turn: beacon for streaming, tool-only, and thinking; partial bubble still readable.
- ElevenLabs TTS: Seneca zone tracks playback; mute/skip stops motion.
- Collapse: strip + floating dock directional micro-indicators; expand restores layout.
- Settings off: dots only, no canvas rAF.
- Reduced motion: static icons even if toggle on.

Done items below are kept for context — they cover the journey from MVP Phase 1 through Phase 7 cleanup. The order matches the build sequence; each entry names its entry point files so the next agent can navigate the codebase by feature.

### ✅ Done — Map tab (Phase 3, vision §8.7)

Shipped. Leaflet + leaflet-draw integration with persistence, vision capture, and four `map_*` tools. The Caspian energy corridor demo from vision §4.2 works end-to-end. Hot files for future maintenance: [`apps/web/src/components/Canvas/MapTab.tsx`](../apps/web/src/components/Canvas/MapTab.tsx), [`apps/web/src/lib/mapActions.ts`](../apps/web/src/lib/mapActions.ts), [`apps/web/src/lib/mapBridge.ts`](../apps/web/src/lib/mapBridge.ts).

### ✅ Done — Web tab (Phase 3, vision §8.6)

Shipped. Sanitised HTML proxy with SSRF guard, Tavily-backed search with a clickable card list, URL bar with back / forward / reload, vision capture, and persistence (URL + history). Hot files: [`apps/web/src/components/Canvas/WebTab.tsx`](../apps/web/src/components/Canvas/WebTab.tsx), [`apps/web/src/lib/webActions.ts`](../apps/web/src/lib/webActions.ts), [`apps/api/src/lib/webProxy.ts`](../apps/api/src/lib/webProxy.ts), [`apps/api/src/routes/web.ts`](../apps/api/src/routes/web.ts).

### ✅ Done — Document tab (Phase 3, vision §8.5)

Shipped. PDF upload via drag-drop or file picker (≤25 MB, magic-byte validated server-side), react-pdf viewer with prev / next / jump-to-page / page-of-N, multi-document sidebar with click-to-switch and inline confirm-on-delete, native text selection via the PDF.js text layer, vision capture (snapshots the rendered page canvas only — not the chrome), and `document_go_to_page` for AI-driven navigation. Bytes live in a private Supabase Storage bucket (`seneca-documents`, path `{userId}/{sessionId}/{docId}.pdf`) in real-auth mode and a process-local `Map<docId, Buffer>` in dev-bypass mode — both implement one `DocumentStore` interface so the rest of the codebase doesn't branch.

**Superseded:** Seneca reads PDFs (and all supported formats) via `document_read_page` without vision — see Priority 1a below. Vision remains valuable for layout, diagrams, and scanned pages where the visual fallback matters.

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

### `apps/web/src/lib/workspaceContext.ts` — use the real Zustand field names

`buildWorkspaceContext` reads from `useSenecaStore.getState()` — the slice keys are `mapState`, `documentsState`, `webState`, and `documentsState.items`, **not** `map`, `documents`, `web`, or `docs.records`. Getting this wrong silently produces empty context (Seneca thinks the board is blank). There is a unit test in `workspaceContext.test.ts`; run it after any store refactor.

### `apps/api/src/routes/chat.ts` — cross-turn `tool_result` round-trip is live

Phase 3 closed tech-debt #1; Phase H extended it with optional `ToolResult.output` JSON. `TranscriptMessage.tools` holds every `tool_use` Claude emitted for an assistant turn; `buildAnthropicMessages` re-emits them and synthesises matching `tool_result` blocks from the client's `pendingToolResults` queue on the next user turn (errors as strings, successes as serialised `output`). Anthropic only accepts `tool_result` blocks whose `tool_use_id` refers to a still-attached `tool_use` — so **don't drop `tools` from the persisted transcript**, and **don't strip `tool_use` blocks from the rehydrated assistant content** in `buildAnthropicMessages`. Both will resurrect the orphan-id crash. **Within a single turn**, client tools still receive synthetic `"ok"` so the agent loop can chain — don't expect rich `output` until the next user message.

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

Most tools follow a one-sided contract: Claude calls them, the client mutates the canvas, the cross-turn `tool_result` round-trip (Phase 3) carries any failure back, and the chip shows the outcome. Six tools today are different — they're *content-returning* (or content-creating) so the `tool_result` body actually matters to the next iteration. The agent loop in [`apps/api/src/routes/chat.ts`](../apps/api/src/routes/chat.ts) resolves them inline and feeds the real content back:

- **`web_read_page`** — `fetchAndSanitise` + `extractTextFromHtml`, JSON envelope with text + url + title.
- **`diagram_read`** — parses persisted `session.diagrams.xml` via `diagramGraph.ts`; returns vertices, edges, bounds, warnings, optional Mermaid. Live edits ride `workspace_context` on the next user message (`getLiveXml()` on the client).
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
