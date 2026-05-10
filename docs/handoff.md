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

~4.5k LoC across 47 files. No TODOs / FIXMEs in code.

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
│              └─ WhiteboardTab           │                      │
│                 (Excalidraw, refs only) │                      │
└───────────────────────┬─────────────────┘                      │
                        │ runTurn → POST /api/chat │ /api/vision │
                        │  (SSE: text + action + done + error)   │
                        ▼                                         │
                  Express                                         │
                    requireAuth (or dev bypass)                  │
                    sessionStore.{memory,supabase}               │
                    Anthropic SDK streaming + agent loop ────────┘
                    └→ Supabase (auth + sessions table)
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

1. **Tool-result round-trip across turns is disabled** (see [`actions.md`](actions.md)). Failed tool calls show red chips but don't notify Seneca on the next turn. Fixing this requires extending the persisted `TranscriptMessage` schema to carry assistant tool_use blocks structurally, then properly threading them through `buildAnthropicMessages` on the server. Touches both shared types and the session-store schema. Needed for vision §8.8 last bullet.
2. **No session list UI.** Currently one auto-created session per user. Vision §7 requires "create, name, resume, delete". This is Phase 4.
3. **Server-side transcript persistence is text-only.** Tool chips on past Seneca turns are lost across page reloads in real-auth mode. Conflated with item 1 — solve them together.
4. **Excalidraw + StrictMode is disabled globally.** We dropped `<StrictMode>` because Excalidraw 0.18's internal `useSyncExternalStore` infinite-loops in StrictMode. Ideally we'd wrap the non-Excalidraw subtree in StrictMode separately. Low priority.
5. **`whiteboardBgFor()` hardcodes hex colours** that mirror `--c-surface` and `--c-surface-sunk`. If theme tokens change, this drifts. Either expose the token values via a JS helper or accept the duplication. Low priority.
6. **No tests.** Zero unit tests, integration tests, or e2e tests. Acceptable while we're in vertical-slice mode. Adding Vitest for unit-test coverage of `runTurn`, `actionDispatcher`, `buildAnthropicMessages`, and `sessionStore` is the highest-value first investment.
7. **No cost telemetry.** Vision §9 wants <$50/month at moderate use. We don't currently measure tokens-per-turn or sum cost. Add a per-turn token-usage event from the API and accumulate it client-side.
8. **`useEffect` lint disabled per file** by leaving `noUnusedLocals: false` and similar. Tighten as the codebase stabilises.
9. **No request-coalescing on whiteboard saves.** A burst of Excalidraw onChange calls triggers many `PUT /api/sessions/{id}/whiteboard` requests within the 600ms debounce. The debounce works, but a single in-flight save isn't cancelled by a newer one. Probably fine for MVP; revisit if it ever pegs the API.

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
9. [`docs/actions.md`](actions.md) — protocol contract, useful when adding new tools.

---

## 3. Vision tracking

### MVP scope (vision §7)

| Requirement | Status | Where |
|---|---|---|
| Single-user email/password auth (Supabase) | ✅ | `auth/AuthProvider.tsx`, `middleware/auth.ts` |
| Dev-bypass mode | ✅ extra | `lib/devBypass.ts`, `lib/sessionStore.ts` |
| Persistent session list (create, name, resume, delete) | ❌ | One auto-session only; Phase 4 work |
| Voice pane (STT, TTS, transcript, mute/pause, vision toggle) | ✅ | `components/VoicePane/*`, `hooks/use*` |
| Text input fallback | ✅ | inside `VoicePane.tsx` |
| Whiteboard tab | ✅ | `components/Canvas/WhiteboardTab.tsx` |
| Document tab (PDF upload + viewing) | ❌ | Phase 3 |
| Web tab (URL input + sanitised proxy) | ❌ | Phase 3 |
| Map tab (Leaflet, layers, AI pins/fly-to) | ❌ | Phase 3 |
| Vision toggle (capture active canvas → Claude) | ✅ | `components/VoicePane/VisionToggle.tsx`, `lib/captureCanvas.ts` |
| AI action execution (whiteboard) | ✅ | server agent loop + `lib/actionDispatcher.ts` |
| AI action execution (map / doc / web / tab.switch) | ❌ | Phase 3 |

### Acceptance criteria (vision §8)

Per-section detail; tick when every subcriterion passes.

- **§8.1 Auth & Session Management** — partial. Auth ✓. Session list ✗. Persistence across logout ✓ in real-auth mode.
- **§8.2 Voice Pane** — ✓ all bullets.
- **§8.3 Vision Toggle** — ✓ all bullets.
- **§8.4 Whiteboard Tab** — ✓ all bullets except: AI free-draw renders as multi-point line (deliberate; documented).
- **§8.5 Document Tab** — ✗ not started.
- **§8.6 Web Tab** — ✗ not started.
- **§8.7 Map Tab** — ✗ not started.
- **§8.8 AI Action Execution** — partial. Schema ✓. Streaming dispatch ✓. Auto-tab-switch ✓ for whiteboard. Failure-feedback round-trip ✗ (see tech debt #1).
- **§8.9 Tab System** — ✓ in shape; only whiteboard is functional, others are placeholders.
- **§8.10 Session Persistence** — ✓ for whiteboard scene + transcript text in real-auth mode. ✗ for tool records and (when added) map/doc/web state.

### Open questions (vision §11)

| # | Question | Resolution |
|---|---|---|
| 11.1 | Tool-use API vs XML | ✅ Tool-use API (Anthropic). Decision documented in [`actions.md`](actions.md). |
| 11.2 | Whiteboard scene-JSON vs PNG for vision | 🟡 Shipping PNG (matches vision §6 dataflow). Scene-JSON experiment deferred. |
| 11.3 | Web proxy depth | 🟡 Decision documented (strip all JS) but tab not yet built. |
| 11.4 | TTS quality | 🟡 Browser TTS shipped. Upgrade to ElevenLabs only if it breaks usability. |
| 11.5 | System prompt persona | ✅ Hardcoded Seneca persona in `packages/shared/src/prompt.ts`. |
| 11.6 | Rate limits / abuse | 🔒 Deferred until productisation. |
| 11.7 | OSS licensing (MIT vs AGPL) | 🔒 **Decision needed before pushing the GitHub repo public.** Default to MIT if user has no preference. |
| 11.A | Cross-turn tool_result reporting | 🆕 New deferred item; see tech debt #1. |

---

## 4. Recommended next steps (prioritised)

Pick from these in order. Each item names the entry point file and approximate scope. Stay in vertical slices — finish one fully before starting another.

### 🥇 Priority 1 — Map tab (Phase 3, vision §8.7)

**Why first:** the geopolitics use case (vision §4.2 — Caspian energy corridor) is the most visually compelling demo of the voice+vision+action loop. Leaflet integration is straightforward and the new `map_*` tools slot into the existing agent-loop architecture with no infrastructure changes.

**Scope:**

- Install `leaflet` + `react-leaflet` + `leaflet-draw` + their types.
- Build `apps/web/src/components/Canvas/MapTab.tsx` mirroring `WhiteboardTab`'s shape (single-mount, useState-snapshot, capture pipeline registration).
- Add at least two tile layers: OpenStreetMap and Esri World Imagery. Layer toggle UI in the tab's corner.
- Add persistence: extend `WhiteboardState` analog → `MapState { center, zoom, layer, pins, shapes }`. Add a `map` jsonb column to the sessions table; mirror in `sessionStore`.
- Capture: register a Leaflet capturer in `lib/captureCanvas.ts` using `leaflet-image` or `html2canvas` over the map container, then through the existing downscale.
- New tools in `packages/shared/src/tools.ts`:
  - `map_fly_to` (`lat`, `lng`, `zoom?`, `label?`)
  - `map_drop_pin` (`lat`, `lng`, `label`)
  - `map_draw_shape` (`type: "polygon" | "polyline"`, `points: [[lat,lng], ...]`, `label?`)
  - `map_set_layer` (`layer: "standard" | "satellite"`)
- Dispatcher branches in `lib/actionDispatcher.ts`. Each should call `setActiveTab("map", { pulse: true })` before mutating the map.
- Presenter entries in `lib/toolSummary.ts`.
- Update the Seneca prompt to introduce these tools.

**Definition of done:** "Walk me through the Caspian energy corridor" produces a fly-to, pin-drops at key cities, and a polyline along the BTC pipeline — with conversational accompaniment. The use case from vision §4.2 works end-to-end.

### 🥈 Priority 2 — Web tab (Phase 3, vision §8.6)

**Scope:** URL bar, back/forward/reload, AI-triggered `web_navigate` and `web_search`. Backend proxy at `/api/fetch-page` that fetches the URL, strips all scripts via `sanitize-html`, rewrites relative URLs, and returns the sanitised HTML for an iframe-with-srcdoc. Vision capture grabs `document.documentElement` via `html2canvas`. Web search via Tavily (cheaper LLM-shaped responses per vision §5).

**Watch out for:** Tavily key is a separate paid account — surface this in the setup doc. Many sites will render poorly under script-stripping; document the limitation in the tab UI.

### 🥉 Priority 3 — Document tab (Phase 3, vision §8.5)

**Scope:** PDF upload (drag-drop, file picker, ≤25MB, PDFs only), `react-pdf` viewer, multi-document sidebar, prev/next/jump-to-page, `document_go_to_page` action. Files go to Supabase Storage in real-auth mode; in dev-bypass mode keep them in an in-memory `Map<docId, Uint8Array>` so the bypass path stays self-contained.

**Watch out for:** PDF.js worker setup with Vite has quirks — pin the worker URL to a same-origin `?url` import or use the worker bundled with `react-pdf`.

### Priority 4 — Real auth gates + session list (Phase 4, vision §8.1 / §8.10)

**Scope:** Session list page (`/sessions`), create / rename / delete UIs, route guard, session-switching that swaps the Zustand state cleanly. Add `tools` column to the persisted transcript so tool chips survive reload (this also addresses tech debt #1 — extend `TranscriptMessage` to carry assistant `tool_use` blocks, persist them, and rehydrate them in `buildAnthropicMessages`).

**Watch out for:** session-switching needs to abort any in-flight stream and reset Excalidraw's scene cleanly. The "mount only when ready" pattern in `CanvasContainer` should be reused — unmount and remount on session change with a `key={sessionId}`.

### Priority 5 — Lightweight test harness

**Scope:** Add Vitest + happy-dom. Cover:

- `lib/runTurn.ts` — happy path, retry on transient error, system bubble on permanent error.
- `lib/actionDispatcher.ts` — each tool routes correctly; failure modes.
- `lib/whiteboardActions.ts` — `coerceAddInput` rejects garbage, builds correct skeletons.
- `apps/api/src/routes/chat.ts` — `buildAnthropicMessages` shape; agent-loop termination.
- `apps/api/src/lib/sessionStore.ts` — both implementations satisfy the same interface.

**Why now:** the codebase has stabilised; any next agent will benefit from a green CI signal. Aim for ~80% line coverage on the listed files before moving on to mobile or eval work.

### Priority 6 — Cost telemetry (vision §9)

Surface per-turn token counts from the Anthropic stream's `message_delta`'s `usage` field, emit them as a new SSE event, accumulate on the client, and show a tiny readout in the header (something like "1.2k in / 480 out, $0.04 turn"). Persist a rolling total per session.

### Deferred / mode-dependent

- Tool-result failure round-trip (tech debt #1) — couple with Priority 4.
- Mobile layout — vision §3 says desktop-first; tackle after a few weeks of dogfooding (vision §10 Phase 5).
- StrictMode reintroduction for non-Excalidraw subtrees — chase once Excalidraw upstream fixes its `useSyncExternalStore` issue.
- ElevenLabs TTS upgrade — only if browser TTS becomes a real blocker.
- Multi-persona switching — explicitly deferred to post-MVP per vision §11.5.

---

## 5. Gotchas and load-bearing decisions

Read this list before touching the files mentioned. These bit us once and shouldn't bite again.

### `apps/web/src/main.tsx` — no StrictMode

Excalidraw 0.18's `useSyncExternalStore` infinite-loops during the StrictMode double-mount cleanup phase. We surfaced this as "Maximum update depth exceeded" originating in `Set.forEach` inside Excalidraw's store. Do not wrap the tree in `<StrictMode>` again until the upstream issue is fixed or the Excalidraw subtree is isolated.

### `apps/web/src/components/Canvas/WhiteboardTab.tsx` — read whiteboard ONCE

Do **not** add `useSenecaStore((s) => s.whiteboard)`. Doing so creates: `onChange → setWhiteboard → selector fires → initialData prop identity changes → Excalidraw setState in cleanup → infinite loop`. The pattern is `useState(() => store.getState().whiteboard)` to snapshot at mount. The CanvasContainer gates the mount behind `session.id !== null && whiteboard !== null` so the snapshot is meaningful.

### `apps/api/src/routes/chat.ts` — agent-loop synthetic acks

The server runs a `for (let iter = 0; iter < MAX_AGENT_ITERATIONS; iter++)` loop, manually appending the assistant turn plus a synthetic `tool_result: "ok"` user turn between iterations. The client does **not** send tool results back. If you re-enable cross-turn tool_result reporting, you must also persist the assistant's `tool_use` blocks structurally in `TranscriptMessage` and thread them through `buildAnthropicMessages`. Anthropic will hard-reject any `tool_result` referencing an orphan `tool_use_id`.

### Tool names use underscores

Anthropic's `tools[*].name` regex is `^[a-zA-Z0-9_-]{1,128}$` — no dots. We use `whiteboard_add_element` on the wire even though the vision doc uses `whiteboard.add_element`. Keep this consistent for any new tool family (`map_fly_to`, `web_navigate`, etc.).

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
