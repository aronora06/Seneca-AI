# Seneca — Vision & Requirements

> Project name: **Seneca**. The application *is* the agent — users converse with Seneca, not with a chat assistant inside an app called Seneca.

---

## 0. Instructions to the LLM Coder

You are building Seneca: a multimodal AI collaboration tool that pairs a voice-driven LLM tutor with an interactive canvas (whiteboard, document viewer, web browser, map, code editor, data viz). The product's core thesis is that current AI chat tools force users to choose between voice and visuals — Seneca lets you do both at once, like sitting next to a person with a whiteboard and a browser open.

**Naming convention.** The application *is* the agent. The user is not "chatting with an assistant inside Seneca" — they are talking *with* Seneca. Treat this like the way people refer to Claude: a singular, named interlocutor. The system prompt and any user-facing copy should reinforce this identity. The character of Seneca takes inspiration from Lucius Annaeus Seneca the Younger — Roman Stoic, patient correspondent, philosophical mentor — warm, rigorous, comfortable with hard questions, willing to think alongside the user rather than perform expertise at them.

**Working style for this project:**

1. **Decisions are made — don't re-litigate them.** Tech stack choices in §5 are committed. If a choice blocks you, surface it explicitly with the trade-off; don't quietly substitute.
2. **MVP first, ruthlessly.** Anything not in §7 (MVP Scope) is out. If you find yourself building auth flows, plugin systems, or "extensibility hooks" before the core loop works end-to-end, stop and ship the core loop.
3. **Minimal from-scratch engineering.** Use battle-tested libraries (Excalidraw, Leaflet, PDF.js, CodeMirror). Do not write a custom whiteboard engine. Do not write a custom map renderer. Wrap and integrate.
4. **Mobile-aware, desktop-first.** MVP targets desktop browsers (1280px+). Do not adopt libraries that have no mobile path. Do not optimize for mobile yet.
5. **Voice and vision are the differentiator.** When in doubt, invest there. The canvas tabs are table stakes; the seamless voice + canvas + vision loop is the product.
6. **When you hit ambiguity:** check §11 (Open Questions). If it's listed, pick the simpler option and flag it. If it's not listed, ask before building.
7. **Build in vertical slices.** Don't build all the canvas tabs before the voice loop works. Get whiteboard + voice + Claude + vision toggle working end-to-end before adding map, code, etc.
8. **Acceptance criteria are testable.** Each requirement in §8 has a checklist. A feature is not done until every box is checked.

---

## 1. Vision

A web-deployed AI interlocutor — Seneca — that behaves like a knowledgeable person sitting next to you with a whiteboard, a browser, and a stack of reference materials. You speak to Seneca; Seneca speaks back. You both share a canvas where either of you can draw, surface images, navigate maps, scroll documents, or pull up web content. Seneca sees what you see (when you let him), and you can interrupt, redirect, or hand him the pen.

The product unlocks open-ended use cases — philosophy tutoring, geopolitical analysis, language learning, technical mentoring, document study sessions — without requiring the user to context-switch between a chat window and a separate visual workspace.

## 2. Core Value Proposition

A single, unified interface where:
- Voice conversation runs continuously alongside an interactive canvas.
- The AI can both **see** the canvas and **act on** it (place images, annotate, navigate maps, open documents).
- The user can do the same — drawing, uploading, browsing — without leaving the conversation.
- Vision is **toggleable** to control compute and token cost.

## 3. Target User (MVP)

A single technically-comfortable user (the builder) running the app on a desktop browser for self-directed learning sessions. No multi-user collaboration. No team features.

## 4. Use Case Anchors

These are concrete scenarios the MVP must support end-to-end:

1. **Philosophy tutor.** User opens a session, says "let's talk about Spinoza's Ethics." Seneca engages in dialogue, pulls up a portrait of Spinoza on the web tab, opens a key passage in the document tab, sketches the geometric structure of Spinoza's argument on the whiteboard.
2. **Geopolitical analysis.** User says "walk me through the Caspian energy corridor." Seneca opens the map tab, zooms to the Caspian, draws pipeline routes, pulls up recent news articles on the web tab, and discusses the strategic dynamics conversationally.
3. **Document study.** User uploads a PDF, says "let's work through this paper together." Seneca references specific sections, the user highlights or annotates passages, and the conversation flows over both the document and a side whiteboard for note-taking.

## 5. Tech Stack (Committed)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend framework | **React 18 + TypeScript + Vite** | Fast dev loop; matches the team's existing stack |
| Styling | **Tailwind CSS** | Utility-first, mobile-portable |
| State management | **Zustand** | Minimal, no boilerplate |
| Whiteboard | **Excalidraw (npm package)** | Open source, scene format is JSON-serializable for AI consumption, hand-drawn aesthetic |
| Maps | **Leaflet + MapLibre GL** (via react-leaflet) | Free, mobile-ready, vector tile support, multiple layer types |
| Code editor | **CodeMirror 6** | Mobile-friendlier than Monaco, smaller bundle |
| Document viewer | **PDF.js** (via react-pdf) | Standard, handles annotations |
| Web view | **Iframe with srcdoc fallback + sanitized fetch proxy** | True embedded browsing is impossible cross-origin; we'll proxy and render |
| Voice STT | **Web Speech API** (browser native) for MVP | Free, works in Chrome/Edge; Deepgram as upgrade path |
| Voice TTS | **Web SpeechSynthesis API** for MVP | Free, browser native; ElevenLabs as upgrade path |
| LLM | **Anthropic Claude API** (`claude-opus-4-7` for primary, `claude-sonnet-4-6` for cheaper turns) | Vision-capable, strong reasoning |
| Web search | **Brave Search API** or **Tavily** | Cheap, programmatic; Tavily has cleaner LLM-shaped responses |
| Backend | **Node.js + Express + TypeScript** on Railway | Same language as frontend; handles streaming + file uploads cleanly |
| Auth + DB | **Supabase** (Postgres + Auth) | Single-user MVP only needs basic auth; scales |
| File storage | **Supabase Storage** | Uploaded PDFs, images, session artifacts |
| Frontend hosting | **Vercel** | Standard |
| Backend hosting | **Railway** | Standard, supports persistent connections |

**Excluded** (and why):
- Electron / desktop wrappers — kills mobile portability.
- VS Code Copilot UI patterns — non-portable, proprietary.
- Self-hosted LLMs — out of scope for MVP; revisit if cost or privacy becomes a constraint.
- WebRTC / real-time multi-user infrastructure — single user only.
- Native mobile apps — web-first.

## 6. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (React)                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────────────────────────┐ │
│  │  Voice Pane  │  │      Canvas (Tab Container)      │ │
│  │              │  │                                  │ │
│  │  • STT (Web  │  │  ┌─────────────────────────────┐│ │
│  │    Speech)   │  │  │ Whiteboard (Excalidraw)     ││ │
│  │  • TTS (Web  │  │  │ Documents  (PDF.js)         ││ │
│  │    Synthesis)│  │  │ Web        (proxied iframe) ││ │
│  │  • Transcript│  │  │ Map        (Leaflet)        ││ │
│  │  • Vision    │  │  │ Code       (CodeMirror)     ││ │
│  │    toggle 👁  │  │  │ Data Viz   (Recharts)       ││ │
│  └──────────────┘  │  └─────────────────────────────┘│ │
│         │          └──────────────────────────────────┘ │
│         │                          │                     │
│         └──────────┬───────────────┘                     │
│                    │ Zustand store                       │
└────────────────────┼─────────────────────────────────────┘
                     │
                     │ HTTPS + SSE for streaming
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Backend (Node + Express)                    │
│  • /api/chat        → Claude API (streaming)            │
│  • /api/vision      → Claude API with image             │
│  • /api/search      → Tavily/Brave                       │
│  • /api/fetch-page  → sanitized HTML proxy              │
│  • /api/upload      → Supabase Storage                  │
│  • /api/sessions    → CRUD on Supabase Postgres         │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                Supabase (Postgres + Storage + Auth)      │
└─────────────────────────────────────────────────────────┘
```

**Key data flow — the vision toggle:**
1. User toggles 👁 on.
2. Frontend captures current canvas state (Excalidraw scene JSON, current PDF page rendered to image, map screenshot via `leaflet-image`, etc.) and serializes to a single image (HTML canvas → PNG).
3. Image attached to next Claude API call as a base64 image input.
4. Claude responds with text + structured "actions" (see §8.7).
5. Toggle returns to off after the response unless user pins it.

**Key data flow — AI takes action on canvas:**
1. Claude returns response with embedded action blocks: `<action type="whiteboard.draw" payload="..."/>`, `<action type="map.fly_to" payload="..."/>`, etc.
2. Backend parses actions and forwards to frontend over SSE.
3. Frontend dispatches actions to the relevant tab's controller via Zustand.
4. UI updates; tab switches if needed; user sees the AI act in real time.

## 7. MVP Scope

**In scope (must ship):**
- Single-user authentication (email/password via Supabase).
- Persistent session list (create, name, resume, delete).
- Voice pane: live STT, live TTS, transcript log, mute/pause, vision toggle.
- Text input fallback (always available).
- Whiteboard tab.
- Document tab (upload PDF, view, page navigation).
- Web tab (URL input, sanitized rendered view, AI-triggered navigation).
- Map tab (Leaflet with at least 2 layer styles: standard + satellite, AI can fly to coordinates and drop pins).
- Vision toggle that captures current tab and sends to Claude.
- AI action execution: at minimum, drawing on whiteboard, map fly-to + pin, document page navigation, web URL navigation.

**Explicitly out of scope (MVP):**
- Code editor tab (Phase 2).
- Data viz tab (Phase 2).
- Multi-user collaboration.
- Mobile-optimized layout.
- Real-time bidirectional voice (full duplex with interruption).
- Custom AI personas / system prompt management UI (hardcoded for MVP).
- File types beyond PDF (no .docx, .pptx, etc., on day one).
- Public sharing / read-only session links.

## 8. Functional Requirements & Acceptance Criteria

### 8.1 Authentication & Session Management

**Requirement:** User can create an account, log in, and manage learning sessions.

Acceptance criteria:
- [ ] Email/password signup and login flow via Supabase Auth.
- [ ] Authenticated users see a session list on the home screen.
- [ ] User can create a new session with a name.
- [ ] User can rename and delete sessions.
- [ ] Session state (canvas contents, transcript, uploaded files) persists across logouts.
- [ ] Unauthenticated users are redirected to login.

### 8.2 Voice Pane

**Requirement:** Persistent voice interface with STT and TTS.

Acceptance criteria:
- [ ] Voice pane is dockable to left or right side of viewport (user setting persisted).
- [ ] Pane is collapsible to a minimal control strip.
- [ ] STT activates on push-to-talk OR continuous mode (toggle).
- [ ] STT transcripts appear in real time in a scrollable transcript log.
- [ ] TTS speaks AI responses; user can mute, pause, or skip current utterance.
- [ ] Text input always available as a fallback.
- [ ] Transcript persists with the session.
- [ ] User can scroll back through the full conversation history.

### 8.3 Vision Toggle

**Requirement:** User controls when the AI sees the canvas.

Acceptance criteria:
- [ ] Eye icon (👁) toggle visible in voice pane.
- [ ] Default state: OFF.
- [ ] When OFF: no canvas image is sent with API requests.
- [ ] When ON: next outgoing user message includes a snapshot of the active canvas tab.
- [ ] After the response returns, toggle automatically reverts to OFF unless the user has pinned it.
- [ ] Pinned state shows visually distinct (e.g., solid eye icon vs. outline).
- [ ] Vision capture works for all canvas tabs (whiteboard, doc, web, map).
- [ ] Captured image is downscaled to ≤1568×1568 before sending (Claude vision optimal).

### 8.4 Whiteboard Tab

**Requirement:** Free-form drawing canvas the user and AI can both manipulate.

Acceptance criteria:
- [ ] Excalidraw renders fullscreen within the canvas area.
- [ ] User can draw, write text, add shapes, erase using mouse and (when on touch device) finger/pen.
- [ ] User can clear the canvas.
- [ ] Canvas state persists with the session.
- [ ] AI can place text labels, basic shapes (rectangles, ellipses, lines, arrows), and free-draw paths via action commands.
- [ ] AI's additions are visually indistinguishable from user's once placed (no special styling required).

### 8.5 Document Tab

**Requirement:** Upload and view PDF documents.

Acceptance criteria:
- [ ] User can upload a PDF (drag-drop or file picker).
- [ ] PDF renders with page navigation (prev/next, jump to page, page count display).
- [ ] Multiple documents per session, switchable via a sidebar list.
- [ ] AI can navigate to a specific page via action command.
- [ ] User can highlight text (basic — no annotation persistence required for MVP).
- [ ] Documents persist in Supabase Storage; only the uploading user can access them.

### 8.6 Web Tab

**Requirement:** Browse web pages within the canvas.

Acceptance criteria:
- [ ] URL bar at top of tab.
- [ ] User can enter a URL and navigate.
- [ ] Pages render via backend proxy (handles CORS, strips scripts for safety).
- [ ] AI can navigate to a URL via action command.
- [ ] AI can run a web search via action command, results render as a clickable list.
- [ ] Forward/back/reload buttons work.
- [ ] **Limitation accepted:** dynamic JS-heavy sites may not fully render. Document this clearly to the user.

### 8.7 Map Tab

**Requirement:** Interactive world map both user and AI can manipulate.

Acceptance criteria:
- [ ] Leaflet renders fullscreen with smooth pan/zoom.
- [ ] At least two tile layers selectable: standard (OpenStreetMap) and satellite (e.g., Esri World Imagery).
- [ ] User can drop pins, draw polygons/lines (via leaflet-draw plugin).
- [ ] AI can fly to coordinates, drop pins with labels, draw shapes via action commands.
- [ ] Map state persists with the session.
- [ ] Layer toggle visible and functional.

### 8.8 AI Action Execution

**Requirement:** Claude responses can include structured actions that update the canvas.

Acceptance criteria:
- [ ] Define an action schema (JSON or XML-tagged blocks within the response). Recommend tool-use API for cleanest implementation.
- [ ] Backend parses actions from streamed responses.
- [ ] Frontend dispatches actions to the correct tab controller.
- [ ] If an action targets a non-active tab, the UI auto-switches to that tab (with a brief visual indicator).
- [ ] Actions supported at MVP launch:
  - `whiteboard.add_element` (text, shape, path)
  - `whiteboard.clear`
  - `document.go_to_page`
  - `web.navigate`
  - `web.search`
  - `map.fly_to`
  - `map.drop_pin`
  - `map.draw_shape`
  - `tab.switch`
- [ ] Failed actions log gracefully and the AI is notified in the next turn so it can recover.

### 8.9 Tab System

**Requirement:** User and AI can switch between canvas tabs.

Acceptance criteria:
- [ ] Tab bar visible at top of canvas area with: Whiteboard, Documents, Web, Map.
- [ ] Click switches active tab; state of inactive tabs is preserved.
- [ ] AI can switch tabs via `tab.switch` action.
- [ ] Active tab indicator is clear.

### 8.10 Session Persistence

**Requirement:** All work persists across browser refreshes and logins.

Acceptance criteria:
- [ ] Whiteboard scene, map state, current document/page, web URL, and transcript all save to Postgres on change (debounced, not per-keystroke).
- [ ] Reopening a session restores the full state.
- [ ] No data loss on accidental tab close.

## 9. Non-Functional Requirements

- **Performance:** First meaningful paint <2s on broadband. Voice STT-to-AI-response latency <3s for non-vision turns; <6s for vision turns.
- **Cost:** Single-user usage should run <$50/month at moderate use (1–2 hours/day) on Claude API. Use Sonnet for short turns, Opus for complex reasoning. Cache aggressively.
- **Reliability:** Session state must never be lost. All saves are atomic.
- **Security:** Backend API requires Supabase JWT. Web proxy strips scripts and dangerous tags. File uploads scanned for type/size limits (PDFs only, ≤25MB).
- **Accessibility:** Keyboard-navigable. ARIA labels on all controls. Captions on TTS output (transcript serves this).
- **Browser support:** Latest Chrome, Edge, Safari. Firefox best-effort (Web Speech API is weaker there).

## 10. Build Phases

**Phase 0 — Foundation (Week 1)**
- Repo scaffold (Vite + React + TS + Tailwind).
- Supabase project provisioned, auth wired up.
- Backend scaffold (Express + TS) on Railway.
- Hello-world deployed end-to-end.

**Phase 1 — Voice Loop (Week 2)**
- Voice pane component.
- Web Speech STT + TTS integration.
- `/api/chat` endpoint streaming Claude responses.
- Text-only conversation working end-to-end.

**Phase 2 — Whiteboard + Vision (Week 3)**
- Excalidraw integrated.
- Vision toggle implemented.
- Canvas-to-image capture pipeline.
- Claude vision API call working.
- AI can draw on whiteboard via action protocol.

**Phase 3 — Remaining Tabs (Weeks 4–5)**
- Map tab with Leaflet + AI fly-to/pin actions.
- Document tab with PDF upload + navigation.
- Web tab with proxy + AI navigation/search.

**Phase 4 — Polish & Persistence (Week 6)**
- Session list / management.
- Full state persistence.
- Error handling, loading states, empty states.
- Cost telemetry.

**Phase 5 — Dogfood (Week 7+)**
- Use it daily. Fix what breaks. Decide on Phase 2 features (code, data viz) based on actual gaps.

## 11. Open Questions / Decisions Deferred

These need a call before relevant work begins. Surface them; don't quietly resolve them.

1. **Action protocol format.** Anthropic's tool-use API vs. embedded XML tags in response text. Recommend tool-use for structure; flag if it complicates streaming.
2. **Whiteboard image vs. scene JSON for vision.** Sending the Excalidraw scene JSON might be cheaper and more accurate than a rendered PNG. Test both.
3. **Web proxy depth.** How aggressively do we sanitize? Strip all JS, or allow some? Decision: strip all JS for MVP, document the limitation.
4. **TTS quality.** Browser TTS is robotic. At what point do we upgrade to ElevenLabs? Decision: ship browser TTS, upgrade only if it actively breaks usability.
5. **System prompt.** Single hardcoded prompt for MVP, or a "persona picker"? Decision: hardcoded Seneca persona for MVP — Stoic, warm, rigorous, patient correspondent who thinks alongside the user. Prompt should explicitly establish identity ("You are Seneca…") and the collaborative interlocutor stance. Domain modes (philosophy / geopolitics / etc.) handled by user request within conversation, not as separate personas. Multi-persona switching deferred to Phase 2.
6. **Rate limits / abuse.** Single-user MVP, but what if it goes public? Decision: defer until productization decision.
7. **Open-source licensing.** MIT vs. AGPL? Decision needed before public repo.

## 12. Repository Layout (Suggested)

```
/seneca
  /apps
    /web              # React frontend
    /api              # Express backend
  /packages
    /shared           # Shared types (action schema, session models)
  /docs
    vision.md         # this file
    actions.md        # AI action protocol spec
    setup.md          # local dev setup
  package.json        # pnpm workspace
  README.md
```

## 13. Definition of Done (MVP)

The MVP ships when:
- A new user can sign up, log in, and create a session.
- They can have a voice conversation with the AI.
- They can switch between whiteboard, document, web, and map tabs.
- The AI can see the active canvas (vision toggle works) and respond about what it sees.
- The AI can draw on the whiteboard, navigate the map, navigate web pages, and navigate document pages via actions.
- The session persists across logouts.
- The whole loop survives 30 minutes of unrehearsed real use without crashing or losing state.

If those work, ship it. Iterate from there.

---

*End of vision & requirements doc.*
