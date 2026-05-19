# Seneca — Pre-Production UX Polish Roadmap

Eight sequential landings (Phases A–H) that take Seneca from "MVP feature-complete" to "ready for a public pilot." Each phase is a vertical slice — finish fully before the next. Every phase ships behind a clean fallback so the product still works in dev-bypass mode with no third-party keys.

Estimates are calendar-day sized for one engineer working linearly. Visible user value lands at the end of every phase.

## Working principles

- **No regressions in dev-bypass mode.** Every new third-party dependency (TTS, STT, headless browser) must degrade gracefully to "browser-native" or "feature unavailable, message says why" when the relevant key is unset. This is the same pattern Voyage and Tavily already follow.
- **Settings panels become real.** `apps/web/src/components/Settings/` was scaffolded in an earlier exploration but never wired in. This roadmap is the right moment to wire `SettingsModal` into `AppShell` and use it as the home for voice picker, vision default, and persona tuning.
- **Every change ships with tests + docs + a CI-green pass.** Same bar as the Phase 1–7 roadmap.
- **Use the existing tool / store patterns.** No new global state stores; everything new flows through `useSenecaStore`. No new persistence schemes; reuse the `SessionStore` + `documentTextStore` patterns.

---

## Phase A — Vision lock + clearer affordance (~1 day)

**Goal:** Replace the shift-click "pin" hack with a discoverable three-state control. Users today have no way of knowing the vision toggle has a locked-on mode unless they read the tooltip.

**What lands:**

- Replace the single `<VisionToggle>` button with a small **segmented control** in `apps/web/src/components/VoicePane/VisionToggle.tsx`:
  - `Off` (default, no eye icon glow)
  - `Once` (eye armed for next message only — current "armed" state, with an `1×` badge)
  - `Locked` (eye stays on across messages — current "pinned" state, with a small lock icon overlay)
- Add a "Vision default" preference to `useSenecaStore`'s persisted preferences (`apps/web/src/lib/userPreferences.ts`): `"off" | "once" | "locked"`. On session create, the toggle initialises from this preference.
- Add a "Vision" subsection to the `AppearancePanel` (or a new `VisionPanel` if you'd rather group it with voice) so power users can flip the default once.
- Update the system prompt to mention that Seneca should ask the user to "lock the eye" (rather than "shift-click to pin") when vision should stay on across multiple turns.
- Update `docs/actions.md`'s vision section and `README.md`'s vision bullet to drop the shift-click language.
- Add a small **"Vision active" badge** on the active canvas tab whenever vision is armed or locked, so the user can see at a glance whether Seneca will see them on the next message. Today the only indicator is the eye button itself.

**Tests:** vision-state transitions in the store; segmented control keyboard nav.

**Exit criteria:** a brand-new user, with no prior knowledge, can figure out how to keep vision on for an entire study session without reading the tooltip.

---

## Phase B — Live STT into the input box + voice-activity detection (~2 days)

**Goal:** Make voice input feel like a real dictation surface, not a fire-and-forget submit. Today STT auto-submits on `onFinal`, which is too aggressive — users want to see what was transcribed and edit it before sending.

**What lands:**

- **Edit-before-send mode** (default on, toggleable in `VoicePanel`): final STT results stream into the textarea instead of auto-submitting via `submitText`. The user reviews the text, then presses Enter / Send. Shift+microphone tap or a "Hands-free" toggle switches back to today's auto-submit behaviour.
- **Live interim + final captioning inside the textarea**: interim text shows as ghost / italic; finals stay as committed text. Today `interim` is only used for a status indicator; this turns it into a real dictation surface.
- **Voice activity detection (VAD)** for the hands-free path: detect silence ≥ 1.5s after speech and auto-submit. Use the existing `useSpeechRecognition.onend` event plus a debounced silence timer; no extra library needed for the MVP. (Future: swap in `@ricky0123/vad-web` for browser-native VAD if browser STT gets phased out.)
- **Audio waveform indicator** while listening: a small canvas-based bar chart fed by `AudioContext.createAnalyser` so the user sees that the mic is actually hearing them. Lives next to the push-to-talk button.
- **"Spacebar to talk"** keyboard shortcut (held) — like Cursor's. Disabled when a text input is focused.
- New voice preferences in `userPreferences.ts`: `editBeforeSend: boolean`, `vadEnabled: boolean`, `pttKey: string`. Settings panel exposes them.

**Tests:** silence-detection debounce, edit-before-send keyboard flow, waveform analyser cleanup on unmount.

**Exit criteria:** a user can dictate an entire two-paragraph message, edit a typo, and send — never touching the keyboard except to fix one word.

---

## Phase C — Premium TTS (Seneca's voice) (~2–3 days)

**Goal:** Replace the browser's `SpeechSynthesisUtterance` with a premium provider. Browser TTS quality varies wildly across OSes; on Linux and many Chromebooks it's frankly unusable.

**Recommended provider: ElevenLabs.** Reasons:

- Best-in-class quality at the level required to make voice feel like a person rather than a robot.
- Voice Library (~1000 voices) lets users pick a voice that matches their preference — important for a product whose differentiator is voice.
- Streaming API (WebSocket or chunked HTTP) keeps latency low enough for real-time conversation.
- Has a free tier (10k chars/mo) and a generous Starter tier ($5/mo for 30k chars), so dev usage stays cheap.
- Documented as the target in vision §11.4.

**Alternatives considered (and why not for Phase C):**

| Provider | Pros | Cons |
|---|---|---|
| OpenAI TTS (`tts-1`, `tts-1-hd`) | Very cheap ($15 / 1M chars), simple API, 6 voices | Only 6 voices, no voice library; quality below ElevenLabs |
| Cartesia Sonic | Lowest latency in the industry (~90ms TTFB) | Smaller voice library, less mature SDK |
| Azure Speech | Many neural voices, generous free tier | Pay-by-character, more complex SDK |
| Google Cloud TTS (Neural2 / Studio) | Quality is excellent, many languages | SDK heavier than ElevenLabs; harder to stream |

We ship ElevenLabs as the primary path and keep browser TTS as the fallback. Replacing the provider later is one file (`apps/api/src/lib/tts.ts`).

**What lands:**

- New `apps/api/src/lib/elevenLabsTTS.ts` — thin client around `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream`. Streams audio chunks back. Errors map to a typed `TTSError` (`unconfigured` | `rate_limited` | `upstream_failed` | `voice_not_found`).
- New env vars in `apps/api/.env.example` + `docs/setup.md` §2.7: `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, `ELEVENLABS_MODEL_ID` (default `eleven_turbo_v2_5`).
- New route `POST /api/tts` (auth-gated, rate-limited per user) — takes `{ text, voice_id?, format? }`, returns a `Content-Type: audio/mpeg` stream.
- Curated **voice picker** in `VoicePanel` (Settings): 6–10 voices pre-vetted by us, each with a 3-second preview. Default to a Seneca-appropriate male voice (something measured and warm — "Brian", "Adam", or "George" from the library).
- Client-side `useElevenLabsSpeech` hook that mirrors `useSpeechSynthesis`'s interface (`speak`, `pause`, `resume`, `skip`, `muted`, etc.) but streams audio via `MediaSource` (or `<audio>` + blob URL fallback). When `ELEVENLABS_API_KEY` is unset, the hook silently falls back to `useSpeechSynthesis`.
- **Speech interruption**: when STT detects the user is talking (new `isListening` event mid-playback), pause TTS playback automatically; resume / cancel based on whether the user actually submitted. Today TTS just keeps going. This makes back-and-forth feel natural.
- Cost telemetry extension: surface TTS characters / dollars in the `CostPill` tooltip alongside Anthropic spend. Persist in `sessions.usage` JSONB.

**Tests:** stub the ElevenLabs HTTP boundary; voice picker preview lifecycle; fallback path when `ELEVENLABS_API_KEY` is unset; mid-playback interrupt.

**Exit criteria:** Seneca speaks in a clearly-superior voice; the user can pick from 6+ voices; turning off the ElevenLabs key falls back to browser TTS with no errors.

---

## Phase D — Session UX: previews, search, scrollable history (~1–2 days)

**Goal:** The state already persists — every tab's contents and the transcript with tool chips are saved per session. What's missing is *discoverability*. Today's `SessionsModal` shows a flat list of names; users with 20 sessions can't find anything.

**What lands:**

- **Session preview cards** in the modal: name, last-activity timestamp, document count + thumbnails of the first 1–2 docs, a snippet of the last user message, and small canvas-tab icons indicating which tabs were used.
- **Server-side `lastMessageAt` + `lastUserText` snippet** on the session record (already partly there in `sessions.usage` — extend the existing `bumpUsage` flow to also write these in `appendAssistantTurn`). Migration block in `docs/setup.md`.
- **Search/filter input** at the top of the modal that filters by name + transcript snippet.
- **Pinned sessions** — a star icon on each card; pinned sessions sort to the top.
- **Sessions list page** (`/sessions` route) for the "I want to browse, not just switch" case. The modal stays for fast-switching. The page becomes the home after login.
- **Per-session export**: a "Download" menu item produces a markdown file of `name + date + transcript + active doc list`. Trivial; uses existing transcript shape. Big perceived-value win.
- **Resume hint**: when entering a session, show a small banner at the top of the transcript ("Welcome back. You were on page 47 of Spinoza Letters, with the map zoomed to the Caspian region.") summarising what's loaded. This makes the "state restoration" the user is already getting *visible*.

**Tests:** session-card derivation from `SessionRecord`; search filter; export markdown content.

**Exit criteria:** a user with 20 sessions can find the one about Stoicism in under five seconds; closing the tab and coming back yesterday's session "remembers" without feeling jarring.

---

## Phase E — Web tab: hybrid live rendering via headless Chromium (~3–4 days)

**Goal:** Today's `webProxy` strips all JavaScript, which means dynamic sites (Twitter, YouTube, many news sites, anything React-rendered) display as broken shells. The hybrid strategy keeps the safety of the sanitised proxy for static sites and adds a live-render path for the rest.

**What lands:**

- New `apps/api/src/lib/headlessRender.ts` — wraps `playwright-core` (or `puppeteer-core`, picked together with the user — Playwright is slightly preferred for richer multi-engine support). Configured to run the bundled Chromium and never to install browsers on a managed host that already has them (Railway has Chromium available as a base image).
- New `POST /api/web/render` endpoint that takes `{ url }`, opens it in a fresh page, waits for `networkidle` (≤ 8s), screenshots the viewport, and returns `{ screenshot: base64, title, links: [{href, text, bbox}] }`. SSRF guard reuses the existing `assertHostIsPublic`.
- **Hybrid `web_navigate` resolver** on the server: try `fetchAndSanitise` first; if the result looks like a SPA shell (heuristic: very few `<body>` text nodes, lots of `<script>` tags before sanitising, JS-heavy class names like `__next` / `data-reactroot`), fall back to the headless render. The chip shows which engine produced the page.
- **Click-through on screenshots**: hit-test against the `links` bbox list; clicking calls `web_navigate(href)` so the iframe-style flow keeps working.
- **Reader-mode toggle**: `web_navigate` returns both the live render (for display) and a Mozilla Readability extract (for `web_read_page`). Reader-mode renders a clean text-only view in the same surface; a toggle switches between "live" and "reader" views. This finally closes the deferred "reader-mode" tech-debt item from the previous handoff.
- Tavily search results in `WebSearchOverlay` get a small "live preview" hover that calls the new render endpoint at thumbnail resolution.
- **Cost guard**: headless renders are expensive (CPU + RAM + browser license-time). Per-session rate limit: ≤ 30 renders / hour. Sidebar pill turns yellow at 80%, red at 100%.

**Risks + mitigations:**

- Memory blow-up on Railway: cap concurrent browser contexts at 2, reuse a single browser instance, hard-kill any tab open > 30s.
- Some sites detect Playwright: use `playwright-extra` + `stealth` plugin; document the limitation honestly (some sites just won't work).
- Image-only screenshots are not text-searchable: that's why `web_read_page` continues to use the Readability extract, not the screenshot. The screenshot is for *display*; the text is for *Seneca*.

**Tests:** Playwright stub; SPA-heuristic accuracy; Readability extract for known fixtures; rate-limit budget math.

**Exit criteria:** opening https://twitter.com renders something recognisable; opening https://en.wikipedia.org continues to use the cheap static path; the cost pill warns before a user blows the budget.

---

## Phase F — Pre-deploy hardening + polish (~2 days)

**Goal:** Make the app safe to put behind a public URL.

**What lands:**

- **Rate limiting** on `/api/chat`, `/api/vision`, `/api/web/render`, `/api/tts`. Express middleware with a per-user token bucket; default budget set conservatively (e.g. 60 turns / hour). 429 responses include a `Retry-After` header.
- **Cost cap per user per day**: hard-stop at $X (configurable). When exceeded, the next turn returns a friendly `cost_capped` error and the UI shows a soft block until midnight.
- **Structured logging** via `pino` (replace ad-hoc `console.log`). Levels, request IDs, redacted PII. Production log routes to stdout for Railway.
- **Error monitoring**: Sentry on both client and server. Init in `main.tsx` and `server.ts`. Source maps uploaded in CI.
- **Health + readiness endpoints**: `/api/health` already exists; add `/api/ready` that probes Anthropic + Supabase + Voyage (configurable).
- **Smoke-test CI job** (nightly, separate from PR CI): runs against a deployed preview environment, hits `/api/health`, posts a known-cheap prompt, asserts a sane response.
- **Privacy policy + ToS stub pages** under `/legal/privacy` and `/legal/terms`. Even one-page versions unlock public deploy.
- **Login screen polish**: ~~add an "About" link~~ — done via `/` marketing home and `/about`. Still optional: hero image / animation on login or home (`apps/web/src/assets/images/hero-background.png`).
- **Onboarding tour** for first-time users: a 4-step coachmark sequence (1) voice pane, (2) canvas tabs, (3) vision toggle, (4) sessions. Skippable. Built with a 50-line Popover component; no new dependency.
- **Toast notifications** for transient successes / non-blocking errors (whiteboard saved, document indexed, etc.) — today these are silent or live in red `SystemBubble`s that are too heavy. One new component, one new store slice, ~80 LoC.
- **Keyboard shortcut overlay** (Cmd/Ctrl+/) listing every shortcut. Already scaffolded in `ShortcutsPanel`; wire it to a global keymap.
- **Accessibility pass**: keyboard nav across the canvas + voice pane, focus rings, ARIA roles, color-contrast audit using `axe-core` in the CI test job.

**Tests:** rate-limit middleware (200 → 429 cutoff), cost-cap path, smoke-test script, axe-core fail on missing ARIA.

**Exit criteria:** a Lighthouse a11y score ≥ 95, no Sentry-uncaught exceptions in a 10-turn dogfood session, rate limits + cost cap measurable from the network panel.

---

## Phase H — Environment intelligence (vision-off context) (~2 days) ✅ Shipped

**Goal:** Seneca should know what's on the canvas — active tab, theme, board colours, visible elements, map pins, loaded docs — even when the user keeps the eye off. Whiteboard text should not clip and strokes should stay readable on light boards.

**What landed:**

- **`workspaceContext` on every chat turn** — client builds a structured snapshot in `apps/web/src/lib/workspaceContext.ts`; API injects it as `<workspace_context>` via `formatWorkspaceContextForPrompt` in `packages/shared/src/workspaceContext.ts`. No new env vars; works in dev-bypass and real-auth.
- **Whiteboard scene digest** — viewport bounds + up to 20 elements (type, position, size, truncated text) so Seneca can answer "what's on the board?" without vision.
- **Contrast-aware strokes** — `readResolvedTheme` + recommended stroke colour in context; client may override low-contrast `strokeColor` from the model.
- **Reliable text sizing** — `document.fonts.ready`, canvas `measureText` (Virgil + emoji), post-placement auto-widen, placement lint warnings in `tool_result.output`.
- **Rich `ToolResult.output`** on the next turn for `whiteboard_add_element`, `web_search`, map mutations, `document_go_to_page` (see `docs/actions.md`).
- **`active_tab` persistence** — `PUT /api/sessions/:id/active-tab`; Postgres column + migration in `docs/setup.md` §3.1.

**Tests:** `workspaceContext.test.ts`, `whiteboardScene.test.ts`, `whiteboardActions.test.ts`, shared formatter tests.

**Exit criteria:** With vision off, Seneca correctly describes the active tab, board background, and recent elements; whiteboard titles with emoji do not clip; tool outcomes (success or failure) are visible on the following turn via `tool_result`.

**Known follow-ups (not in this slice):** same-turn rich tool results; optional `whiteboard_get_scene` tool; collision hints between new and existing elements.

---

## Phase I — Zone-based voice activity visuals (~1–2 days) ✅ shipped

**Goal:** Make voice state legible at a glance — who is talking, whether Seneca is still working (not only “grey dot while thinking”), and directional motion aligned with chat layout (user right, Seneca left). Restrained motion; user can disable fancy visuals.

**What landed:**

- **Activity model** — [`apps/web/src/hooks/useVoiceActivity.ts`](../apps/web/src/hooks/useVoiceActivity.ts): phases `idle`, `userListening`, `userDictating`, `senecaSpeaking`, `senecaStreaming`, `senecaTooling`, `senecaThinking` with explicit priority when multiple signals are true. `useVoiceActivityFromStore` pulls `activeTurnId`, `partialText`, `pendingActionLog.length` from Zustand.
- **Preference** — `voiceVisualEffects` (default `true`) in [`userPreferences.ts`](../apps/web/src/lib/userPreferences.ts); fancy canvas loops skipped when off or when `prefers-reduced-motion: reduce` ([`useReducedMotion.ts`](../apps/web/src/hooks/useReducedMotion.ts)).
- **Shared drawing** — [`apps/web/src/lib/barSpectrum.ts`](../apps/web/src/lib/barSpectrum.ts) + [`BarSpectrumCanvas.tsx`](../apps/web/src/components/VoicePane/BarSpectrumCanvas.tsx) (mic, playback, procedural fallback). [`Waveform.tsx`](../apps/web/src/components/VoicePane/Waveform.tsx) is now a thin mic wrapper.
- **Playback analyser** — [`usePlaybackAnalyser.ts`](../apps/web/src/hooks/usePlaybackAnalyser.ts) + [`playbackAudioRegistry.ts`](../apps/web/src/lib/playbackAudioRegistry.ts); ElevenLabs hook registers its `<audio>` element on mount.
- **Zone components** — `UserSpeechIndicator`, `SenecaSpeechIndicator`, `SenecaActivityBeacon`, `CollapsedActivityIndicators`; wired in [`VoicePane.tsx`](../apps/web/src/components/VoicePane/VoicePane.tsx), [`FloatingVoiceDock.tsx`](../apps/web/src/components/VoicePane/FloatingVoiceDock.tsx). Settings toggle in [`VoicePanel.tsx`](../apps/web/src/components/Settings/panels/VoicePanel.tsx).
- **Tests** — [`useVoiceActivity.test.ts`](../apps/web/src/hooks/useVoiceActivity.test.ts) (priority matrix).

**Exit criteria (visual):** met for layout and settings. **Timing feel:** first-pass coordination shipped — see [`docs/handoff.md` §4.1](handoff.md) for what was fixed and what remains.

**Closed follow-ups:**

- ✅ Align `tts.speaking`, ElevenLabs fetch/queue, and `senecaSpeaking` phase (`audioActive` on `useSpeech`).
- ✅ Conversation Mode: VAD `onSpeechEnd` debounce + STT interim drain before submit.
- ✅ `VoiceMode` includes `"thinking"` during active turns; workspace context reflects it.
- ✅ Echo gate / barge-in use TTS pipeline state, not audible-only `speaking`.

- ✅ Tool-gap beacon shows tooling (not writing) while tools are in flight.
- ✅ Client progressive TTS via MediaSource on `/api/tts` (blob fallback on Safari).
- ✅ AppShell `VoiceStatusPill` (dot on mobile, label from `sm+`).

**Open follow-ups (optional / future):**

- ElevenLabs WebSocket path for marginal latency gains on very short utterances.
- Redis-backed rate limits for multi-replica API deploys.

---

## Cross-cutting rules (apply to every phase)

- Every new third-party key (ElevenLabs, Playwright, Sentry, etc.) is **optional** — the app must boot and run a basic conversation with only `ANTHROPIC_API_KEY` set. Phase 1–7 already follow this; do not regress.
- Every phase ships as **one PR**. The PR updates `docs/handoff.md` and ticks the relevant box in this roadmap (rather than editing this file).
- Every phase preserves dev-bypass mode and the existing `*Store` interface pattern (memory + Supabase implementations land together).
- Every new tool follows the existing five-step contract: shared definition + prompt mention + dispatcher (or server-fulfilled branch) + chip presenter + actions.md schema doc.
- Estimated total: ~11–14 days of focused engineering. Visible value lands at the end of every phase.

## What stays explicitly out of scope (and why)

- **Long-term cross-session memory** (e.g. "you mentioned last week you were studying Stoicism") — a real RAG-over-sessions project; revisit when there's actual usage data showing users do return to the same topic.
- **Mobile-optimised layout** — desktop-first per vision §3; this roadmap is about polishing the desktop experience.
- **Multi-persona switching** — vision §11.5 explicitly post-MVP.
- **OCR for scanned PDFs** — visual fallback works; cost-data-driven decision later.
- **`document_edit` collaborative editing** — large UX project (Monaco / block editor + diff UI), separate plan.
- **PDF export of AI-authored docs** — wait for a real user request.

---

## Quick reference — files most likely to change per phase

| Phase | Primary files |
|---|---|
| A — Vision lock | `apps/web/src/components/VoicePane/VisionToggle.tsx`, `apps/web/src/store/seneca.ts`, `apps/web/src/lib/userPreferences.ts`, `apps/web/src/components/Settings/panels/AppearancePanel.tsx`, `packages/shared/src/prompt.ts` |
| B — Live STT | `apps/web/src/hooks/useSpeechRecognition.ts`, `apps/web/src/components/VoicePane/VoicePane.tsx`, `apps/web/src/lib/userPreferences.ts`, new `apps/web/src/components/VoicePane/Waveform.tsx` |
| C — Premium TTS | new `apps/api/src/lib/elevenLabsTTS.ts`, new `apps/api/src/routes/tts.ts`, new `apps/web/src/hooks/useElevenLabsSpeech.ts`, `apps/web/src/components/Settings/panels/VoicePanel.tsx` |
| D — Session UX | `apps/web/src/components/Sessions/SessionsModal.tsx`, new `apps/web/src/components/Sessions/SessionPreviewCard.tsx`, new `apps/web/src/components/Sessions/SessionsPage.tsx`, `apps/api/src/lib/sessionStore.ts`, `apps/api/src/routes/sessions.ts` |
| E — Hybrid web | new `apps/api/src/lib/headlessRender.ts`, `apps/api/src/lib/webProxy.ts`, new `apps/api/src/routes/web.ts` (extend), `apps/web/src/components/Canvas/WebTab.tsx`, new `apps/web/src/components/Canvas/WebReaderView.tsx` |
| F — Hardening | new `apps/api/src/middleware/rateLimit.ts`, new `apps/api/src/lib/logger.ts`, `apps/api/src/server.ts`, `apps/web/src/main.tsx`, new `apps/web/src/components/Onboarding/Tour.tsx`, new `apps/web/src/components/Toast.tsx` |
| G — Conversation Mode | `apps/web/src/hooks/useConversationVad.ts`, `apps/web/src/lib/vadAssets.ts`, `apps/web/src/components/VoicePane/FloatingVoiceDock.tsx`, `GlobalShortcuts.tsx` |
| H — Environment intelligence | `apps/web/src/lib/workspaceContext.ts`, `packages/shared/src/workspaceContext.ts`, `apps/web/src/lib/whiteboardScene.ts`, `apps/web/src/lib/whiteboardActions.ts`, `apps/web/src/lib/toolResultOutputs.ts`, `apps/web/src/lib/persistActiveTab.ts` |
| I — Voice activity visuals | `apps/web/src/hooks/useVoiceActivity.ts`, `apps/web/src/components/VoicePane/*Indicator*.tsx`, `BarSpectrumCanvas.tsx`, `usePlaybackAnalyser.ts`, `VoicePane.tsx`, `FloatingVoiceDock.tsx` |
