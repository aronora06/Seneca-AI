# Seneca

> Seneca is a voice-driven AI interlocutor that shares an interactive canvas with you — a whiteboard you can both draw on, a map you can both pan, a document you can both flip through.

The full vision lives in [docs/vision.md](docs/vision.md). The current state, code-review summary, and prioritised next steps live in [docs/handoff.md](docs/handoff.md). Setup instructions live in [docs/setup.md](docs/setup.md).

## What works today

This repo currently ships **Phases 0–2** of the build (per vision §10) plus theme + tool-chip + retry polish:

- **Sign in** with email + password via Supabase, OR run in dev-bypass mode with no Supabase project required.
- **Voice conversation** with Seneca (Web Speech STT + TTS), dockable pane, push-to-talk and continuous-listen modes, mute / pause / skip, always-on text input fallback.
- **Whiteboard tab** powered by Excalidraw — both you and Seneca can draw.
- **Vision toggle** (👁) — when armed, Seneca sees a downscaled PNG of the active canvas tab with your next message. Pin it on with shift-click.
- **Multi-step tool use** via a server-side agent loop — Seneca can chain `whiteboard_clear` + many `whiteboard_add_element` calls in a single turn and you'll see them appear in sequence.
- **Tool chips** below Seneca's messages show every tool he called, with a status dot and an expandable JSON detail view.
- **System error bubbles** with auto-retry for transient failures and a manual Retry button when a turn fails permanently.
- **Light / dark / system theme** with persisted choice; Excalidraw follows along.
- **Persistence** of the transcript and whiteboard scene per session (Postgres in real-auth mode, in-memory in dev-bypass mode).

Map, Documents, and Web tabs are stubbed in the tab bar and come in Phase 3.

## Project layout

```
seneca/
├── apps/
│   ├── web/             React 18 + Vite + Tailwind + Zustand frontend
│   └── api/             Express + TS backend (Claude streaming, Supabase JWT)
├── packages/
│   └── shared/          TS types, Seneca prompt, tool schemas
└── docs/
    ├── vision.md        Immutable product spec
    ├── setup.md         Account creation + local dev + deploy
    ├── actions.md       Tool / action protocol
    └── handoff.md       Code review, vision tracking, next-agent brief
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

In dev-bypass mode the session lives in memory and resets when the API restarts. Switch to real auth + Postgres persistence via [docs/setup.md §3](docs/setup.md).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Runs `apps/web` and `apps/api` together |
| `pnpm dev:web` | Just the frontend |
| `pnpm dev:api` | Just the backend |
| `pnpm build` | Builds `shared`, then `api`, then `web` |
| `pnpm typecheck` | TS check across all packages |

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Zustand |
| Whiteboard | `@excalidraw/excalidraw` |
| Voice | Browser Web Speech API (STT + TTS) |
| Backend | Node 20+, Express, TypeScript |
| LLM | Anthropic Claude (`claude-opus-4-7` vision, `claude-sonnet-4-6` text) |
| Auth + DB | Supabase (Postgres + Auth) |
| Hosting | Vercel (web) + Railway (api) |

## Working agreement

The codebase follows a few non-obvious conventions that have been earned the hard way:

- **No `StrictMode`** in `main.tsx` — Excalidraw 0.18's internal `useSyncExternalStore` infinite-loops during StrictMode's double-mount. Documented at the top of `main.tsx`.
- **`WhiteboardTab` doesn't subscribe to `state.whiteboard`** — that creates a feedback loop with Excalidraw's `onChange`. Read once via `useState` initialiser; Excalidraw owns live state thereafter.
- **Anthropic tool names use underscores, not dots** (`whiteboard_add_element`, not `whiteboard.add_element`) — Anthropic's API enforces `^[a-zA-Z0-9_-]{1,128}$`.
- **Theme uses semantic colour tokens** (`bg-surface`, `text-fg`, `border-border`, `accent`, `danger`, `ok`) backed by CSS variables on `:root` / `.dark`. Use these instead of raw `ink-*` / `ember-*` classes.
- **Use the shared `useSenecaStore`** for cross-cutting state; component-internal state stays local.

See [docs/handoff.md](docs/handoff.md) for the full handoff brief, code-review notes, and the prioritised next-steps backlog.
