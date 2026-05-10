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
  ToolCallRecord,
  ToolResult,
  TranscriptMessage,
  WhiteboardState,
} from "@seneca/shared";

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

interface StreamingState {
  /** A UUID for the in-flight Seneca turn, or null when idle. */
  activeTurnId: string | null;
  /** Partial assistant text streamed so far. */
  partialText: string;
  /** Tool actions Seneca emitted during this turn (with live status). */
  pendingActionLog: ToolCallRecord[];
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
  streaming: StreamingState;
  /** Tool results pending delivery to Seneca on the next request. */
  pendingToolResults: ToolResult[];

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

  // ── whiteboard
  setWhiteboard: (state: WhiteboardState) => void;

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
  vision: { enabled: false, pinned: false },
  activeTab: "whiteboard",
  tabPulseTarget: null,
  whiteboard: null,
  streaming: {
    activeTurnId: null,
    partialText: "",
    pendingActionLog: [],
  },
  pendingToolResults: [],

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

  setWhiteboard: (state) => set({ whiteboard: state }),

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
}));
