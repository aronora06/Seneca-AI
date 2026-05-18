import { beforeEach, describe, expect, it } from "vitest";

import type {
  DocumentsState,
  MapState,
  TranscriptMessage,
  WebState,
  WhiteboardState,
} from "@seneca/shared";

import {
  useSenecaStore,
  visionModeFor,
  visionStateForMode,
} from "./seneca";
import { DEFAULTS, writePrefs } from "../lib/userPreferences";

const sampleTranscript: TranscriptMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "what's up",
    ts: "2024-01-01T00:00:00.000Z",
  },
];

const sampleWhiteboard: WhiteboardState = { elements: [] };
const sampleMap: MapState = {
  center: [40, -73],
  zoom: 8,
  layer: "standard",
  pins: [],
  shapes: [],
};
const sampleWeb: WebState = {
  url: "https://example.com",
  history: ["https://example.com"],
  historyIndex: 0,
};
const sampleDocuments: DocumentsState = { items: [], activeId: null };

beforeEach(() => {
  useSenecaStore.setState({
    session: { id: null, name: "" },
    transcript: [],
    whiteboard: null,
    mapState: null,
    webState: null,
    documentsState: null,
    streaming: {
      activeTurnId: "stale-turn",
      partialText: "stale",
      pendingActionLog: [{ id: "x", name: "y", input: {} }],
    },
    pendingToolResults: [
      { toolUseId: "z", ok: true, output: "ok" },
    ],
    vision: { enabled: true, pinned: true },
    activeTab: "documents",
    tabPulseTarget: "web",
  });
  // Phase A — reset the persisted vision default to the documented
  // default so loadSession behaviour is deterministic across tests.
  writePrefs({ visionDefault: DEFAULTS.visionDefault });
});

describe("loadSession", () => {
  it("atomically replaces every per-session slice", () => {
    useSenecaStore.getState().loadSession({
      id: "sess-1",
      name: "Tax research",
      transcript: sampleTranscript,
      whiteboard: sampleWhiteboard,
      map: sampleMap,
      web: sampleWeb,
      documents: sampleDocuments,
    });

    const state = useSenecaStore.getState();
    expect(state.session.id).toBe("sess-1");
    expect(state.session.name).toBe("Tax research");
    expect(state.transcript).toBe(sampleTranscript);
    expect(state.whiteboard).toBe(sampleWhiteboard);
    expect(state.mapState).toBe(sampleMap);
    expect(state.webState).toBe(sampleWeb);
    expect(state.documentsState).toBe(sampleDocuments);
  });

  it("clears in-flight streaming and pending tool results", () => {
    useSenecaStore.getState().loadSession({
      id: "sess-2",
      name: "Fresh",
      transcript: [],
      whiteboard: sampleWhiteboard,
      map: sampleMap,
      web: sampleWeb,
      documents: sampleDocuments,
    });

    const state = useSenecaStore.getState();
    expect(state.streaming.activeTurnId).toBeNull();
    expect(state.streaming.partialText).toBe("");
    expect(state.streaming.pendingActionLog).toEqual([]);
    expect(state.pendingToolResults).toEqual([]);
  });

  it("resets vision and tab focus so they don't bleed across sessions", () => {
    useSenecaStore.getState().loadSession({
      id: "sess-3",
      name: "Fresh",
      transcript: [],
      whiteboard: sampleWhiteboard,
      map: sampleMap,
      web: sampleWeb,
      documents: sampleDocuments,
    });

    const state = useSenecaStore.getState();
    expect(state.vision).toEqual({ enabled: false, pinned: false });
    expect(state.activeTab).toBe("whiteboard");
    expect(state.tabPulseTarget).toBeNull();
  });

  it("honours the persisted vision default — 'once' arms the eye", () => {
    writePrefs({ visionDefault: "once" });
    useSenecaStore.getState().loadSession({
      id: "sess-4",
      name: "Once-default",
      transcript: [],
      whiteboard: sampleWhiteboard,
      map: sampleMap,
      web: sampleWeb,
      documents: sampleDocuments,
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: false,
    });
  });

  it("honours the persisted vision default — 'locked' pins the eye", () => {
    writePrefs({ visionDefault: "locked" });
    useSenecaStore.getState().loadSession({
      id: "sess-5",
      name: "Locked-default",
      transcript: [],
      whiteboard: sampleWhiteboard,
      map: sampleMap,
      web: sampleWeb,
      documents: sampleDocuments,
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: true,
    });
  });
});

describe("setVisionMode", () => {
  it("off → once → locked → off transitions cycle the underlying state", () => {
    useSenecaStore.setState({ vision: { enabled: false, pinned: false } });
    const { setVisionMode } = useSenecaStore.getState();

    setVisionMode("once");
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: false,
    });

    setVisionMode("locked");
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: true,
    });

    setVisionMode("off");
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: false,
      pinned: false,
    });
  });

  it("locked → once unpins without turning vision off", () => {
    useSenecaStore.setState({ vision: { enabled: true, pinned: true } });
    useSenecaStore.getState().setVisionMode("once");
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: false,
    });
  });

  it("off → locked enables and pins atomically (no intermediate state)", () => {
    useSenecaStore.setState({ vision: { enabled: false, pinned: false } });
    useSenecaStore.getState().setVisionMode("locked");
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: true,
    });
  });
});

describe("visionStateForMode / visionModeFor", () => {
  it("round-trips every mode through the helpers", () => {
    for (const mode of ["off", "once", "locked"] as const) {
      const state = visionStateForMode(mode);
      expect(visionModeFor(state)).toBe(mode);
    }
  });

  it("treats pinned as locked even when enabled is somehow false", () => {
    // This shape shouldn't occur via setVisionMode but the helper still
    // has to be deterministic: pinned wins because that is the user's
    // explicit "keep it on" intent.
    expect(visionModeFor({ enabled: false, pinned: true })).toBe("locked");
  });
});

describe("enqueueToolResult / drainToolResults", () => {
  it("queues and drains in FIFO order", () => {
    useSenecaStore.setState({ pendingToolResults: [] });
    useSenecaStore.getState().enqueueToolResult({
      toolUseId: "a",
      ok: true,
    });
    useSenecaStore.getState().enqueueToolResult({
      toolUseId: "b",
      ok: false,
      error: "boom",
    });

    const drained = useSenecaStore.getState().drainToolResults();
    expect(drained).toHaveLength(2);
    expect(drained[0]!.toolUseId).toBe("a");
    expect(drained[1]!.toolUseId).toBe("b");
    expect(useSenecaStore.getState().pendingToolResults).toEqual([]);
  });

  it("returns an empty array when nothing is queued", () => {
    useSenecaStore.setState({ pendingToolResults: [] });
    expect(useSenecaStore.getState().drainToolResults()).toEqual([]);
  });
});

describe("applyUsageEvent", () => {
  it("captures the last-turn snapshot and accumulates the session total", () => {
    useSenecaStore.getState().resetUsage();
    useSenecaStore.getState().applyUsageEvent({
      type: "usage",
      turnId: "t-1",
      model: "claude-sonnet-4-5",
      inputTokens: 1_000,
      outputTokens: 200,
      cacheReadInputTokens: 50,
      cacheCreationInputTokens: 10,
      inputCostUSD: 0.04,
      outputCostUSD: 0.01,
    });

    const after = useSenecaStore.getState();
    expect(after.lastTurnUsage).not.toBeNull();
    expect(after.lastTurnUsage!.inputTokens).toBe(1_000);
    expect(after.lastTurnUsage!.model).toBe("claude-sonnet-4-5");
    expect(after.sessionUsage.inputTokens).toBe(1_000);
    expect(after.sessionUsage.outputTokens).toBe(200);
    expect(after.sessionUsage.cacheReadInputTokens).toBe(50);
    expect(after.sessionUsage.cacheCreationInputTokens).toBe(10);
    expect(after.sessionUsage.inputCostUSD).toBeCloseTo(0.04);
    expect(after.sessionUsage.outputCostUSD).toBeCloseTo(0.01);
  });

  it("sums multiple turn events into the session total", () => {
    useSenecaStore.getState().resetUsage();
    useSenecaStore.getState().applyUsageEvent({
      type: "usage",
      turnId: "t-1",
      model: "claude-sonnet-4-5",
      inputTokens: 1_000,
      outputTokens: 200,
      inputCostUSD: 0.03,
      outputCostUSD: 0.01,
    });
    useSenecaStore.getState().applyUsageEvent({
      type: "usage",
      turnId: "t-2",
      model: "claude-sonnet-4-5",
      inputTokens: 500,
      outputTokens: 100,
      inputCostUSD: 0.015,
      outputCostUSD: 0.005,
    });
    const s = useSenecaStore.getState().sessionUsage;
    expect(s.inputTokens).toBe(1_500);
    expect(s.outputTokens).toBe(300);
    expect(s.inputCostUSD).toBeCloseTo(0.045);
    expect(s.outputCostUSD).toBeCloseTo(0.015);
  });

  it("defaults missing cache token fields to zero", () => {
    useSenecaStore.getState().resetUsage();
    useSenecaStore.getState().applyUsageEvent({
      type: "usage",
      turnId: "t-1",
      model: "claude-sonnet-4-5",
      inputTokens: 100,
      outputTokens: 10,
      inputCostUSD: 0,
      outputCostUSD: 0,
    });
    const s = useSenecaStore.getState().sessionUsage;
    expect(s.cacheReadInputTokens).toBe(0);
    expect(s.cacheCreationInputTokens).toBe(0);
  });
});

describe("resetUsage", () => {
  it("zeroes the session total and clears the last-turn snapshot", () => {
    useSenecaStore.getState().applyUsageEvent({
      type: "usage",
      turnId: "t-1",
      model: "claude-sonnet-4-5",
      inputTokens: 5,
      outputTokens: 5,
      inputCostUSD: 0.01,
      outputCostUSD: 0.01,
    });
    useSenecaStore.getState().resetUsage();
    expect(useSenecaStore.getState().lastTurnUsage).toBeNull();
    expect(useSenecaStore.getState().sessionUsage.inputCostUSD).toBe(0);
  });
});

describe("resumeBanner (Phase D)", () => {
  it("loadSession shows the banner when the transcript has prior context", () => {
    useSenecaStore.getState().loadSession({
      id: "sess-banner-1",
      name: "Old session",
      transcript: sampleTranscript,
      whiteboard: sampleWhiteboard,
      map: sampleMap,
      web: sampleWeb,
      documents: sampleDocuments,
    });
    expect(useSenecaStore.getState().resumeBannerVisible).toBe(true);
  });

  it("loadSession hides the banner when the transcript is empty", () => {
    useSenecaStore.getState().loadSession({
      id: "sess-banner-2",
      name: "Fresh",
      transcript: [],
      whiteboard: sampleWhiteboard,
      map: sampleMap,
      web: sampleWeb,
      documents: sampleDocuments,
    });
    expect(useSenecaStore.getState().resumeBannerVisible).toBe(false);
  });

  it("setTranscript mirrors loadSession's visibility rule", () => {
    useSenecaStore.getState().setTranscript(sampleTranscript);
    expect(useSenecaStore.getState().resumeBannerVisible).toBe(true);
    useSenecaStore.getState().setTranscript([]);
    expect(useSenecaStore.getState().resumeBannerVisible).toBe(false);
  });

  it("appendTranscript dismisses the banner once a new turn arrives", () => {
    useSenecaStore.getState().setTranscript(sampleTranscript);
    expect(useSenecaStore.getState().resumeBannerVisible).toBe(true);
    useSenecaStore.getState().appendTranscript({
      id: "u2",
      role: "user",
      text: "next question",
      ts: "2024-01-01T01:00:00.000Z",
    });
    expect(useSenecaStore.getState().resumeBannerVisible).toBe(false);
  });

  it("dismissResumeBanner hides it without touching the transcript", () => {
    useSenecaStore.getState().setTranscript(sampleTranscript);
    useSenecaStore.getState().dismissResumeBanner();
    expect(useSenecaStore.getState().resumeBannerVisible).toBe(false);
    expect(useSenecaStore.getState().transcript).toEqual(sampleTranscript);
  });
});
