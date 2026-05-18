/**
 * Single Zustand store for Seneca's UI state.
 *
 * We keep the entire client state in one tree because the cross-talk
 * between the voice pane, the canvas tabs, and the streaming layer is
 * dense enough that splitting it into many stores would create more
 * coupling than it removes.
 */

import { create } from "zustand";
import type {
  DocumentsState,
  MapState,
  SessionUsage,
  ToolCallRecord,
  ToolResult,
  TranscriptMessage,
  UsageStreamEvent,
  WebState,
  WhiteboardState,
} from "@seneca/shared";
import { DEFAULT_SESSION_USAGE } from "@seneca/shared";

import { readPrefs, type VisionDefault } from "../lib/userPreferences";

export type DockSide = "left" | "right";
export type VoiceMode = "idle" | "listening" | "speaking";
export type ActiveTab = "whiteboard" | "documents" | "web" | "map";

interface VoicePaneState {
  dockSide: DockSide;
  collapsed: boolean;
  mode: VoiceMode;
  muted: boolean;
  continuousListening: boolean;
  /** Interim STT result not yet committed to the transcript. */
  interimSpeech: string;
}

interface VisionState {
  enabled: boolean;
  pinned: boolean;
}

/**
 * Phase A — Vision lock.
 *
 * The three states the segmented control exposes to the user. The
 * underlying `vision: { enabled, pinned }` shape is preserved because
 * the capture pipeline (`runTurn.ts`) and the auto-revert logic at turn
 * end read those fields directly; `VisionMode` is a UI-facing alias
 * with crisp semantics:
 *
 *  - "off"    — `enabled: false, pinned: false`
 *  - "once"   — `enabled: true,  pinned: false`  (auto-reverts to off
 *               after one turn — see runTurn.ts)
 *  - "locked" — `enabled: true,  pinned: true`   (stays on across turns)
 */
export type VisionMode = "off" | "once" | "locked";

export function visionStateForMode(mode: VisionMode): VisionState {
  switch (mode) {
    case "off":
      return { enabled: false, pinned: false };
    case "once":
      return { enabled: true, pinned: false };
    case "locked":
      return { enabled: true, pinned: true };
  }
}

export function visionModeFor(state: {
  enabled: boolean;
  pinned: boolean;
}): VisionMode {
  if (state.pinned) return "locked";
  if (state.enabled) return "once";
  return "off";
}

function visionStateForDefault(def: VisionDefault): VisionState {
  return visionStateForMode(def);
}

interface StreamingState {
  /** A UUID for the in-flight Seneca turn, or null when idle. */
  activeTurnId: string | null;
  /** Partial assistant text streamed so far. */
  partialText: string;
  /** Tool actions Seneca emitted during this turn (with live status). */
  pendingActionLog: ToolCallRecord[];
}

/**
 * Phase 4: the most recent per-turn cost reading, used for the
 * "$0.04 turn" half of the header pill. Cleared on session switch and
 * on `beginTurn`.
 */
interface LastTurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  inputCostUSD: number;
  outputCostUSD: number;
  model: string;
}

interface SessionState {
  id: string | null;
  name: string;
}

interface SenecaState {
  session: SessionState;
  transcript: TranscriptMessage[];
  voice: VoicePaneState;
  vision: VisionState;
  activeTab: ActiveTab;
  tabPulseTarget: ActiveTab | null;
  whiteboard: WhiteboardState | null;
  mapState: MapState | null;
  webState: WebState | null;
  documentsState: DocumentsState | null;
  streaming: StreamingState;
  /** Tool results pending delivery to Seneca on the next request. */
  pendingToolResults: ToolResult[];
  /** Rolling per-session token + USD totals (Phase 4). */
  sessionUsage: SessionUsage;
  /** The most recent per-turn usage event, if any. */
  lastTurnUsage: LastTurnUsage | null;

  // ── voice
  setDockSide: (side: DockSide) => void;
  toggleCollapsed: () => void;
  setVoiceMode: (mode: VoiceMode) => void;
  setMuted: (muted: boolean) => void;
  setContinuousListening: (on: boolean) => void;
  setInterimSpeech: (interim: string) => void;

  // ── vision
  toggleVisionArmed: () => void;
  toggleVisionPinned: () => void;
  setVisionEnabled: (enabled: boolean, opts?: { pinned?: boolean }) => void;
  /** Phase A — set the vision mode directly (segmented control). */
  setVisionMode: (mode: VisionMode) => void;

  // ── transcript
  setTranscript: (transcript: TranscriptMessage[]) => void;
  appendTranscript: (msg: TranscriptMessage) => void;
  popLastTranscript: () => TranscriptMessage | null;
  patchLastSenecaTurn: (patch: Partial<TranscriptMessage>) => void;

  // ── tabs
  setActiveTab: (tab: ActiveTab, opts?: { pulse?: boolean }) => void;
  clearTabPulse: () => void;

  // ── session
  setSession: (id: string, name?: string) => void;
  /**
   * Atomic session switch: replaces every per-session slice in a single
   * `set` call, clears the in-flight streaming + pending tool result
   * queue, and resets vision so it doesn't bleed across sessions.
   * Mounting / unmounting of canvas tabs is left to the AppShell via
   * `<CanvasContainer key={sessionId} />`.
   */
  loadSession: (input: {
    id: string;
    name: string;
    transcript: TranscriptMessage[];
    whiteboard: WhiteboardState;
    map: MapState;
    web: WebState;
    documents: DocumentsState;
  }) => void;

  // ── whiteboard
  setWhiteboard: (state: WhiteboardState) => void;

  // ── map
  setMap: (state: MapState) => void;

  // ── web
  setWeb: (state: WebState) => void;

  // ── documents
  setDocuments: (state: DocumentsState) => void;

  // ── streaming
  beginTurn: (turnId: string) => void;
  appendPartial: (delta: string) => void;
  pushPendingAction: (rec: ToolCallRecord) => void;
  updatePendingAction: (
    id: string,
    update: Partial<ToolCallRecord>,
  ) => void;
  resetStreaming: () => void;

  // ── tool results queue
  enqueueToolResult: (result: ToolResult) => void;
  drainToolResults: () => ToolResult[];

  // ── cost telemetry (Phase 4)
  applyUsageEvent: (event: UsageStreamEvent) => void;
  setSessionUsage: (usage: SessionUsage) => void;
  resetUsage: () => void;

  /**
   * Phase C — debit TTS character usage. `costUSD` is the running
   * provider cost (already computed at the call site so the store
   * stays free of pricing concerns).
   */
  bumpTtsUsage: (characters: number, costUSD: number) => void;
}

const DOCK_STORAGE_KEY = "seneca:dockSide";
const CONTINUOUS_STORAGE_KEY = "seneca:continuousListening";

function readDockSide(): DockSide {
  try {
    const v = localStorage.getItem(DOCK_STORAGE_KEY);
    return v === "right" ? "right" : "left";
  } catch {
    return "left";
  }
}

function writeDockSide(side: DockSide): void {
  try {
    localStorage.setItem(DOCK_STORAGE_KEY, side);
  } catch {
    // ignore — local storage may be disabled
  }
}

function readContinuous(): boolean {
  try {
    return localStorage.getItem(CONTINUOUS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeContinuous(on: boolean): void {
  try {
    localStorage.setItem(CONTINUOUS_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // ignore
  }
}

/**
 * Read the user's persisted "vision default" preference. Safe at module
 * load (no DOM dependency beyond what `readPrefs()` already guards) and
 * always returns a valid VisionDefault — falling back to "off" if the
 * preferences blob is unreadable.
 */
function readVisionDefault(): VisionDefault {
  try {
    return readPrefs().visionDefault;
  } catch {
    return "off";
  }
}

export const useSenecaStore = create<SenecaState>((set, get) => ({
  session: { id: null, name: "" },
  transcript: [],
  voice: {
    dockSide: readDockSide(),
    collapsed: false,
    mode: "idle",
    muted: false,
    continuousListening: readContinuous(),
    interimSpeech: "",
  },
  // Phase A — boot the vision toggle from the user's persisted default
  // so the first session of the day already reflects their preference.
  // `loadSession` re-applies the same logic on every session switch.
  vision: visionStateForDefault(readVisionDefault()),
  activeTab: "whiteboard",
  tabPulseTarget: null,
  whiteboard: null,
  mapState: null,
  webState: null,
  documentsState: null,
  streaming: {
    activeTurnId: null,
    partialText: "",
    pendingActionLog: [],
  },
  pendingToolResults: [],
  sessionUsage: { ...DEFAULT_SESSION_USAGE },
  lastTurnUsage: null,

  setDockSide: (side) => {
    writeDockSide(side);
    set((s) => ({ voice: { ...s.voice, dockSide: side } }));
  },
  toggleCollapsed: () =>
    set((s) => ({ voice: { ...s.voice, collapsed: !s.voice.collapsed } })),
  setVoiceMode: (mode) => set((s) => ({ voice: { ...s.voice, mode } })),
  setMuted: (muted) => set((s) => ({ voice: { ...s.voice, muted } })),
  setContinuousListening: (on) => {
    writeContinuous(on);
    set((s) => ({ voice: { ...s.voice, continuousListening: on } }));
  },
  setInterimSpeech: (interim) =>
    set((s) => ({ voice: { ...s.voice, interimSpeech: interim } })),

  toggleVisionArmed: () =>
    set((s) => {
      if (s.vision.pinned) return s;
      return { vision: { enabled: !s.vision.enabled, pinned: false } };
    }),
  toggleVisionPinned: () =>
    set((s) => {
      const pinned = !s.vision.pinned;
      return { vision: { enabled: pinned ? true : s.vision.enabled, pinned } };
    }),
  setVisionEnabled: (enabled, opts) =>
    set((s) => ({
      vision: {
        enabled,
        pinned: opts?.pinned ?? s.vision.pinned,
      },
    })),
  setVisionMode: (mode) => set({ vision: visionStateForMode(mode) }),

  setTranscript: (transcript) => set({ transcript }),
  appendTranscript: (msg) =>
    set((s) => ({ transcript: [...s.transcript, msg] })),
  popLastTranscript: () => {
    const cur = get().transcript;
    if (cur.length === 0) return null;
    const last = cur[cur.length - 1] ?? null;
    set({ transcript: cur.slice(0, -1) });
    return last;
  },
  patchLastSenecaTurn: (patch) =>
    set((s) => {
      for (let i = s.transcript.length - 1; i >= 0; i--) {
        if (s.transcript[i]!.role === "seneca") {
          const next = [...s.transcript];
          next[i] = { ...next[i]!, ...patch };
          return { transcript: next };
        }
      }
      return s;
    }),

  setActiveTab: (tab, opts) =>
    set((s) => ({
      activeTab: tab,
      tabPulseTarget: opts?.pulse && tab !== s.activeTab ? tab : null,
    })),
  clearTabPulse: () => set({ tabPulseTarget: null }),

  setSession: (id, name) =>
    set((s) => ({ session: { id, name: name ?? s.session.name } })),

  loadSession: ({ id, name, transcript, whiteboard, map, web, documents }) =>
    set({
      session: { id, name },
      transcript,
      whiteboard,
      mapState: map,
      webState: web,
      documentsState: documents,
      streaming: {
        activeTurnId: null,
        partialText: "",
        pendingActionLog: [],
      },
      pendingToolResults: [],
      // Phase A — seed the vision toggle from the user's persisted
      // default so power users don't have to flip the eye every session.
      vision: visionStateForDefault(readVisionDefault()),
      activeTab: "whiteboard",
      tabPulseTarget: null,
      sessionUsage: { ...DEFAULT_SESSION_USAGE },
      lastTurnUsage: null,
    }),

  setWhiteboard: (state) => set({ whiteboard: state }),

  setMap: (state) => set({ mapState: state }),

  setWeb: (state) => set({ webState: state }),

  setDocuments: (state) => set({ documentsState: state }),

  beginTurn: (turnId) =>
    set({
      streaming: {
        activeTurnId: turnId,
        partialText: "",
        pendingActionLog: [],
      },
    }),
  appendPartial: (delta) =>
    set((s) => ({
      streaming: {
        ...s.streaming,
        partialText: s.streaming.partialText + delta,
      },
    })),
  pushPendingAction: (rec) =>
    set((s) => ({
      streaming: {
        ...s.streaming,
        pendingActionLog: [...s.streaming.pendingActionLog, rec],
      },
    })),
  updatePendingAction: (id, update) =>
    set((s) => ({
      streaming: {
        ...s.streaming,
        pendingActionLog: s.streaming.pendingActionLog.map((rec) =>
          rec.id === id ? { ...rec, ...update } : rec,
        ),
      },
    })),
  resetStreaming: () =>
    set({
      streaming: {
        activeTurnId: null,
        partialText: "",
        pendingActionLog: [],
      },
    }),

  enqueueToolResult: (result) =>
    set((s) => ({ pendingToolResults: [...s.pendingToolResults, result] })),
  drainToolResults: () => {
    const cur = get().pendingToolResults;
    if (cur.length > 0) set({ pendingToolResults: [] });
    return cur;
  },

  applyUsageEvent: (event) =>
    set((s) => {
      const cacheRead = event.cacheReadInputTokens ?? 0;
      const cacheWrite = event.cacheCreationInputTokens ?? 0;
      return {
        lastTurnUsage: {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadInputTokens: cacheRead,
          cacheCreationInputTokens: cacheWrite,
          inputCostUSD: event.inputCostUSD,
          outputCostUSD: event.outputCostUSD,
          model: event.model,
        },
        sessionUsage: {
          inputTokens: s.sessionUsage.inputTokens + event.inputTokens,
          outputTokens: s.sessionUsage.outputTokens + event.outputTokens,
          cacheReadInputTokens:
            s.sessionUsage.cacheReadInputTokens + cacheRead,
          cacheCreationInputTokens:
            s.sessionUsage.cacheCreationInputTokens + cacheWrite,
          inputCostUSD: s.sessionUsage.inputCostUSD + event.inputCostUSD,
          outputCostUSD: s.sessionUsage.outputCostUSD + event.outputCostUSD,
          updatedAt: new Date().toISOString(),
        },
      };
    }),

  setSessionUsage: (usage) => set({ sessionUsage: usage }),

  resetUsage: () =>
    set({
      sessionUsage: { ...DEFAULT_SESSION_USAGE },
      lastTurnUsage: null,
    }),

  bumpTtsUsage: (characters, costUSD) =>
    set((s) => ({
      sessionUsage: {
        ...s.sessionUsage,
        ttsCharacters: (s.sessionUsage.ttsCharacters ?? 0) + characters,
        ttsCostUSD: (s.sessionUsage.ttsCostUSD ?? 0) + costUSD,
        updatedAt: new Date().toISOString(),
      },
    })),
}));
