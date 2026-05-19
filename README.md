# Seneca

> Seneca is a voice-driven AI interlocutor that shares an interactive canvas with you — a whiteboard you can both draw on, a map you can both pan, a web page you can both read, a document you can both flip through.

The full vision lives in [docs/vision.md](docs/vision.md). The current state, code-review summary, and the prioritised next-steps backlog live in [docs/handoff.md](docs/handoff.md). The pre-production polish roadmap (Phases A–I) lives in [docs/ux_polish_roadmap.md](docs/ux_polish_roadmap.md). Open voice timing issues are tracked in [docs/handoff.md §4.1](docs/handoff.md). Setup instructions live in [docs/setup.md](docs/setup.md). The tool / action protocol is documented in [docs/actions.md](docs/actions.md).

## Routing

The web app is a single Vite SPA with path-based routes:

- **`/`** — public marketing home
- **`/about`**, **`/privacy`**, **`/terms`** — public information pages
- **`/login`** — sign in / sign up (redirects to `/app` when already authenticated)
- **`/app`** — voice + canvas workspace (lazy-loaded; requires auth in production)

In local dev with `VITE_DEV_BYPASS_AUTH=true`, `/app` opens the workspace without login; `/` still shows marketing. See [docs/setup.md](docs/setup.md) for deploy notes (`vercel.json` rewrites and Supabase redirect URLs).

## What works today

Every MVP slice in vision §7 has shipped, plus the document-intelligence depth (Priorities 1a–1d), cost telemetry, and the test harness / CI / cleanup work that came with them:

### Conversation

- **Sign in** with email + password via Supabase, OR run in **dev-bypass mode** with no Supabase project required.
- **Voice conversation** with Seneca (Web Speech STT + TTS), dockable pane, push-to-talk and continuous-listen modes, **Conversation Mode** (Silero VAD — toggle with `C` or the dock; see [setup §2.10](docs/setup.md)), mute / pause / skip, always-on text input fallback.
- **Dictation surface**: STT final results stream into the input box (with the current interim transcript painted as ghost text *inside* the textarea) so you can review and edit before sending. Toggle "Hands-free" for the classic auto-submit path with voice-activity detection that submits ~1.5s after you stop talking. A global "hold Space to talk" shortcut works anywhere outside an input field (configurable in Settings → Voice & Audio).
- **Zone-based voice activity visuals**: directional indicators show when you're speaking (mic bars on the input rail), when Seneca is speaking (playback-reactive waveform with ElevenLabs, procedural shimmer with browser TTS), and when Seneca is still working (thinking / writing / using tools) via a beacon above the transcript. Collapsed pane and floating dock show matching micro-indicators. Toggle **Settings → Voice & Audio → Activity visuals** to use minimal dots instead; OS reduced-motion forces static states. *Timing and progressive TTS playback were tuned in May 2026* — see [handoff §4.1](docs/handoff.md). The AppShell header shows a live voice-activity pill when Seneca or you are active.
- **Premium TTS via ElevenLabs**: set `ELEVENLABS_API_KEY` (see [setup §2.7](docs/setup.md#27-optional-enable-premium-voice-elevenlabs)) and Seneca speaks through a curated set of six streaming neural voices with ~300ms time-to-first-byte and a "Premium" badge in the voice pane. Pick a voice (preview included) in Settings → Voice & Audio. When the key is unset, the app silently falls back to the browser's built-in `SpeechSynthesisUtterance` — no errors, no broken UI, same dev-bypass-friendly pattern Voyage and Tavily use. Cost telemetry flows into the session usage pill so you can see your TTS spend alongside Anthropic.
- **System error bubbles** with auto-retry for transient failures and a manual Retry button when a turn fails permanently.
- **Per-turn + per-session cost pill** in the header showing token counts and dollar totals (Sonnet / Opus / Haiku pricing baked in via `apps/api/src/lib/pricing.ts`).

### Canvas tabs (all five shipped)

- **Whiteboard tab** powered by Excalidraw — both you and Seneca can draw. Text elements are sized with canvas `measureText` (Virgil + emoji-aware fallback), auto-widened after placement when the box would clip, and placement feedback (position, size, contrast colour, layout warnings) is returned to Seneca on the following turn.
- **Diagrams tab** powered by draw.io embed — structured flowcharts, architecture, and ER diagrams. Seneca uses `diagram_load` / `diagram_merge` / `diagram_clear` plus `diagram_read` (server), granular edits (`diagram_set_label`, `diagram_remove_cells`, `diagram_add_nodes`, `diagram_layout`), and rich `tool_result` feedback (diff, warnings, bounds). Workspace context includes vertex/edge digests; live embed XML feeds context and tool results between autosaves. Optional `VITE_DRAWIO_EMBED_URL` (defaults to `https://embed.diagrams.net`).
- **Map tab** powered by Leaflet + leaflet-draw — pan / zoom / draw, switch between standard and satellite tiles, AI can fly-to, drop pins, and draw polylines / polygons via `map_*` tools.
- **Web tab** with a sanitised HTML proxy (SSRF-guarded), URL bar with back / forward / reload, Tavily-backed search with a clickable card list, and `web_navigate` / `web_search` / `web_read_page` tools.
- **Documents tab** with drag-drop or file-picker upload (≤25 MB), multi-document sidebar with click-to-switch and inline confirm-on-delete, page navigation, and a "✦" badge on AI-authored docs.

### Documents — multi-format, multi-tool

- **Upload anything Seneca can read**: PDF, `.docx`, `.pptx`, `.md` / `.markdown` / `.txt`, `.html` / `.htm`. The extractor registry in `apps/api/src/lib/documentExtractors/` dispatches by MIME → extension → magic-byte sniff. PDFs render through `react-pdf`; everything else renders through a themed markdown viewer (`marked` + DOMPurify).
- **Seneca can read every format** via `document_read_page` (cheap text path for born-digital pages; server-rasterised multimodal `tool_result` image for scanned PDFs — no eye-toggle required).
- **Seneca can introspect** via `document_list` ("what have I uploaded?").
- **Seneca can find phrases semantically** via `document_search` — cosine top-k over Voyage AI embeddings (`voyage-3-large`, 1024-dim) + pgvector. Substring fallback runs when Voyage is unconfigured or upstream errors so search never hard-errors.
- **Seneca can write new docs** via `document_create` — markdown stays inline in `document_pages` (no Storage blob), the sidebar updates mid-turn via a `documents-updated` SSE event, and the new doc is immediately searchable.

### Vision

- **Vision toggle** — a three-state segmented control (Off / Once / Locked). "Once" sends a downscaled PNG of the active canvas tab with your next message, then reverts. "Locked" keeps vision live across every message until you switch it off. The active canvas tab shows an inline badge whenever vision is on so you always know whether Seneca will see you. The default state for new sessions is picked in Settings → Appearance → Vision default.
- **Environment intelligence (vision off)** — every `/api/chat` and `/api/vision` request carries a `workspaceContext` snapshot that is injected into the system prompt as `<workspace_context>`. Seneca gets the active tab, light/dark theme, whiteboard background + recommended stroke colour, visible viewport bounds, a compact digest of on-canvas elements (up to 20), diagrams vertex/edge summaries (when the tab has content), map centre/layer/pins, loaded documents (with text/index status), current web URL (or whether a search overlay is open), and voice mode (idle / listening / speaking, muted). When vision was armed but capture failed, the next turn notes that explicitly. This is the cheap "accessibility tree" path — structured facts instead of pixels. See [docs/actions.md — Workspace context](docs/actions.md).
- **Multi-step tool use** via a server-side agent loop — Seneca can chain `whiteboard_clear` + many `whiteboard_add_element` calls in a single turn and you'll see them appear in sequence.
- **Tool chips** below Seneca's messages show every tool he called, with a status dot and an expandable JSON detail view. Phase 3 made these persist server-side, so a reload preserves them.
- **Cross-turn `tool_result` round-trip** — failures *and structured successes* (whiteboard placement bounds, search results, map state after pins, document page after navigation) reach Seneca on the next turn via `ToolResult.output` (see [docs/actions.md](docs/actions.md)).

### Sessions

- **Persistent session list** — create, rename, delete (inline confirm), switch. The AppShell header opens a `SessionsModal`. Switching fully remounts the canvas via a `key={sessionId}` boundary. Preview cards show the last user question, document count, and which canvas tabs were used; a search input filters by name or transcript snippet; a star pins frequently-used sessions to the top; and a download icon exports any session as markdown.
- **Resume hint** — when you switch into a session that already has context, a small "Welcome back" banner above the transcript reminds you what's loaded (open document + page, attached doc count, last question you asked). It disappears the moment you send a new message.
- **Hybrid web tab** — the Web tab tries a sanitised static fetch first, then falls back to a headless Chromium render when the result looks like a JS shell (see [setup §2.8](docs/setup.md#28-optional-enable-live-web-rendering-headless-chromium)). The live engine returns a viewport screenshot with hover-highlighted clickable link overlays plus an extracted reader view; the footer shows which engine produced the page and how much of the per-session headless budget is left (30 / hour). Without `playwright-core` installed everything still works through the static path — no errors, no broken UI.
- **Cascade delete** wipes pages, chunks, bytes, and the Storage bucket prefix together so a deleted session leaves nothing behind.
- **Persistence** of the transcript (with persisted `tool_use` blocks), whiteboard scene, map state, web URL + history, documents metadata + active doc + per-doc current page, last focused canvas tab (`active_tab`), and rolling per-session cost totals (Postgres in real-auth mode, in-memory in dev-bypass).

### Theme

- **Light / dark / system theme** with persisted choice. Excalidraw, Leaflet, and the markdown viewer all follow along. CSS variables on `:root` / `.dark` map to Tailwind semantic tokens (`bg-surface`, `text-fg`, `border-border`, `accent`, `danger`, `ok`).

### Pre-deploy hardening

- **Rate limits + cost cap.** Every expensive route (`/api/chat`, `/api/vision`, `/api/tts`, `/api/web/render`) is wrapped in a per-user sliding-window limiter (default 60 turns / hour, route-scaled multipliers). `/api/chat` and `/api/vision` also enforce a per-user per-day USD cost cap before starting a turn. Both knobs live in `apps/api/.env` (`RATE_LIMIT_TURNS_PER_HOUR`, `COST_CAP_USD_PER_DAY`); set either to 0 to disable. The user gets a readable transcript notice when either trips.
- **Structured logging + request IDs.** Every request gets an `X-Request-Id` header (honours an inbound one if a reverse proxy sets it) and one JSON log line on completion (`method / path / status / durationMs / requestId`). PII-shaped fields (`email`, `jwt`, `*token*`, `*secret*`, `authorization`, `password`) are redacted automatically. Adjust verbosity via `LOG_LEVEL=debug|info|warn|error`.
- **Readiness probe.** `GET /api/ready` returns 200/503 plus a check object — `anthropic`, `supabase`, plus the three optional integrations — without making outbound calls. Wire your deploy platform's healthcheck at it.
- **Toast notifications + keyboard shortcut overlay.** Pop-up toasts surface session events (export success / failure, delete) with `aria-live` announcements. Press ⌘/Ctrl + `/` anywhere to see the full keyboard shortcut list.
- **Onboarding hint** the first time you open Seneca on a new browser, plus first-class `#privacy` and `#terms` pages reachable from the login screen.
- **Accessibility spot-fixes** on the login form (tab list, `aria-busy`, `aria-invalid`, `aria-describedby`) and the app shell (status indicator, session switcher).

### Quality bar

- ~500+ unit tests across `apps/api`, `apps/web`, and `packages/shared` run under `pnpm test`. GitHub Actions runs `typecheck` + `test` + `build` on every push and PR.
- TypeScript strict + `noUnusedLocals` + `noUnusedParameters` enabled globally.
- MIT licensed (see [LICENSE](LICENSE)).

## Project layout

```
seneca/
├── apps/
│   ├── web/             React 18 + Vite + Tailwind + Zustand frontend
│   └── api/             Express + TS backend (Claude streaming, Supabase JWT)
├── packages/
│   └── shared/          TS types, Seneca prompt, tool schemas
├── docs/
│   ├── vision.md        Immutable product spec
│   ├── setup.md         Account creation + local dev + deploy
│   ├── actions.md       Tool / action protocol
│   └── handoff.md       Code review, vision tracking, next-agent brief
└── .github/workflows/
    └── ci.yml           CI: typecheck + test + build on push / PR
```

## Quick start (no Supabase needed)

You need Node 20+ and `pnpm 11+`. If you don't have them, see [docs/setup.md §1](docs/setup.md).

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Open apps/api/.env and paste your Anthropic key into ANTHROPIC_API_KEY.
# Everything else defaults to dev-bypass mode.

pnpm install
pnpm dev
```

- Web: http://localhost:5173 (lands straight in the app — no login screen)
- API: http://localhost:8787
- Health: http://localhost:8787/api/health

In dev-bypass mode every session lives in memory and resets when the API restarts. To get real auth, persistence, semantic document search, and document blob storage, work through [docs/setup.md §3](docs/setup.md) (Supabase + Postgres + pgvector) and optionally [docs/setup.md §2.5 / §2.6](docs/setup.md) (Tavily web search + Voyage embeddings).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs `apps/web` and `apps/api` together |
| `pnpm dev:web` | Just the frontend |
| `pnpm dev:api` | Just the backend |
| `pnpm build` | Builds `shared`, then `api`, then `web` |
| `pnpm typecheck` | TS check across all packages |
| `pnpm test` | Runs the Vitest suites in every workspace |

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Zustand |
| Whiteboard | `@excalidraw/excalidraw` |
| Map | `leaflet`, `leaflet-draw` |
| Documents | `react-pdf` (PDFs), `marked` + DOMPurify (markdown / docx / pptx / html) |
| Voice | Browser Web Speech API (STT + TTS) |
| Backend | Node 20+, Express, TypeScript |
| LLM | Anthropic Claude (`claude-opus-4-7` vision, `claude-sonnet-4-6` text) |
| Embeddings | Voyage AI (`voyage-3-large`, 1024-dim) |
| Web search | Tavily |
| Auth + DB | Supabase (Postgres + Auth + Storage + pgvector) |
| Hosting | Vercel (web) + Railway (api) |

## Working agreement

The codebase follows a few non-obvious conventions that have been earned the hard way:

- **No root-level `StrictMode`** in `main.tsx` — Excalidraw 0.18's `useSyncExternalStore` infinite-loops during StrictMode's double-mount. `CanvasContainer` instead wraps every non-whiteboard tab subtree in `<StrictMode>` individually, so we get the safety checks everywhere except where Excalidraw lives.
- **`WhiteboardTab` doesn't subscribe to `state.whiteboard`** — that creates a feedback loop with Excalidraw's `onChange`. Read once via `useState` initialiser; Excalidraw owns live state thereafter.
- **Anthropic tool names use underscores, not dots** (`whiteboard_add_element`, not `whiteboard.add_element`) — Anthropic's API enforces `^[a-zA-Z0-9_-]{1,128}$`.
- **Theme uses semantic colour tokens** (`bg-surface`, `text-fg`, `border-border`, `accent`, `danger`, `ok`) backed by CSS variables on `:root` / `.dark`. Use these instead of raw `ink-*` / `ember-*` classes. When you need a token value in JS (e.g. for `whiteboardBgFor`), read it from `getComputedStyle` and cache by theme.
- **Use the shared `useSenecaStore`** for cross-cutting state; component-internal state stays local. The store also owns `pendingToolResults` for the cross-turn `tool_result` round-trip (including optional `output` JSON).
- **Every chat turn sends `workspaceContext`** — built in `apps/web/src/lib/workspaceContext.ts`, formatted in `packages/shared/src/workspaceContext.ts`, merged in `buildSystemPrompt` inside `apps/api/src/routes/chat.ts`. Keep this in sync when you add new canvas state the model should know about.
- **Tool-use protocol is one-sided within a turn, two-sided across turns** — see [docs/actions.md](docs/actions.md) for the full contract. Within a turn, client tools still get a synthetic `"ok"` so the agent loop can continue; rich `output` arrives on the *next* user message.

See [docs/handoff.md](docs/handoff.md) for the full handoff brief, code-review notes, and the prioritised next-steps backlog.

## License

[MIT](LICENSE) © 2026 Aaron Parker. Use it, fork it, ship something with it.
