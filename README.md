# Seneca

> Seneca is a voice-driven AI interlocutor that shares an interactive canvas with you — a whiteboard you can both draw on, a map you can both pan, a web page you can both read, a document you can both flip through.

The full vision lives in [docs/vision.md](docs/vision.md). The current state, code-review summary, and the prioritised next-steps backlog live in [docs/handoff.md](docs/handoff.md). The active pre-production polish roadmap lives in [docs/ux_polish_roadmap.md](docs/ux_polish_roadmap.md). Setup instructions live in [docs/setup.md](docs/setup.md). The tool / action protocol is documented in [docs/actions.md](docs/actions.md).

## What works today

Every MVP slice in vision §7 has shipped, plus the document-intelligence depth (Priorities 1a–1d), cost telemetry, and the test harness / CI / cleanup work that came with them:

### Conversation

- **Sign in** with email + password via Supabase, OR run in **dev-bypass mode** with no Supabase project required.
- **Voice conversation** with Seneca (Web Speech STT + TTS), dockable pane, push-to-talk and continuous-listen modes, mute / pause / skip, always-on text input fallback.
- **Dictation surface**: STT final results stream into the input box (with the current interim transcript painted as ghost text *inside* the textarea) so you can review and edit before sending. Toggle "Hands-free" for the classic auto-submit path with voice-activity detection that submits ~1.5s after you stop talking. A small waveform indicator sits next to the mic so you can see your voice is being heard, and a global "hold Space to talk" shortcut works anywhere outside an input field (configurable in Settings → Voice & Audio).
- **System error bubbles** with auto-retry for transient failures and a manual Retry button when a turn fails permanently.
- **Per-turn + per-session cost pill** in the header showing token counts and dollar totals (Sonnet / Opus / Haiku pricing baked in via `apps/api/src/lib/pricing.ts`).

### Canvas tabs (all four shipped)

- **Whiteboard tab** powered by Excalidraw — both you and Seneca can draw.
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
- **Multi-step tool use** via a server-side agent loop — Seneca can chain `whiteboard_clear` + many `whiteboard_add_element` calls in a single turn and you'll see them appear in sequence.
- **Tool chips** below Seneca's messages show every tool he called, with a status dot and an expandable JSON detail view. Phase 3 made these persist server-side, so a reload preserves them.
- **Cross-turn `tool_result` round-trip** — real failure strings reach Seneca on the next turn (see [docs/actions.md](docs/actions.md)).

### Sessions

- **Persistent session list** — create, rename, delete (inline confirm), switch. The AppShell header opens a `SessionsModal`. Switching fully remounts the canvas via a `key={sessionId}` boundary.
- **Cascade delete** wipes pages, chunks, bytes, and the Storage bucket prefix together so a deleted session leaves nothing behind.
- **Persistence** of the transcript (with persisted `tool_use` blocks), whiteboard scene, map state, web URL + history, documents metadata + active doc + per-doc current page, and rolling per-session cost totals (Postgres in real-auth mode, in-memory in dev-bypass).

### Theme

- **Light / dark / system theme** with persisted choice. Excalidraw, Leaflet, and the markdown viewer all follow along. CSS variables on `:root` / `.dark` map to Tailwind semantic tokens (`bg-surface`, `text-fg`, `border-border`, `accent`, `danger`, `ok`).

### Quality bar

- ~280 unit tests across `apps/api`, `apps/web`, and `packages/shared` run under `pnpm test`. GitHub Actions runs `typecheck` + `test` + `build` on every push and PR.
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
- **Use the shared `useSenecaStore`** for cross-cutting state; component-internal state stays local. The store also owns `pendingToolResults` for the cross-turn `tool_result` round-trip.
- **Tool-use protocol is one-sided within a turn, two-sided across turns** — see [docs/actions.md](docs/actions.md) for the full contract.

See [docs/handoff.md](docs/handoff.md) for the full handoff brief, code-review notes, and the prioritised next-steps backlog.

## License

[MIT](LICENSE) © 2026 Aaron Parker. Use it, fork it, ship something with it.
