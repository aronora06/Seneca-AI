/**
 * Tandem (sentence-streaming) TTS test for `runTurn`.
 *
 * Locks in the contract that `onSpoken` is fired multiple times per
 * turn, with sentence-sized chunks, as text deltas arrive — including
 * across tool calls. This is what lets the user hear Seneca start
 * talking before tools finish.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSenecaStore } from "../store/seneca";

let dispatchEvent: ((e: unknown) => void) | null = null;
let resolveStream: ((value: void) => void) | null = null;

vi.mock("./api", async () => {
  const actual =
    await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    apiStream: vi.fn(
      async (
        _path: string,
        _body: unknown,
        handlers: {
          onEvent: (e: unknown) => void;
          onError: (err: Error) => void;
          signal?: AbortSignal;
        },
      ) => {
        dispatchEvent = handlers.onEvent;
        return new Promise<void>((resolve) => {
          resolveStream = resolve;
        });
      },
    ),
  };
});

vi.mock("./captureCanvas", () => ({
  captureActiveTab: vi.fn().mockResolvedValue(null),
}));

vi.mock("./actionDispatcher", () => ({
  dispatchToolCall: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./userPreferences", () => ({
  readPrefs: () => ({
    customInstructions: { aboutYou: "", howToRespond: "" },
    visionDefault: "off",
  }),
}));

import { runTurn } from "./runTurn";

beforeEach(() => {
  dispatchEvent = null;
  resolveStream = null;
  useSenecaStore.setState((s) => ({
    ...s,
    session: { id: "s-test", name: "Test", createdAt: "", updatedAt: "" },
    transcript: [],
    streaming: {
      ...s.streaming,
      activeTurnId: null,
      partialText: "",
      pendingActionLog: [],
      pendingToolResults: [],
    },
  }));
});

describe("runTurn sentence-streaming TTS (tandem)", () => {
  it("fires onSpoken per sentence as deltas arrive", async () => {
    const spoken: string[] = [];
    const turnPromise = runTurn({
      userText: "Hi",
      onSpoken: (s) => spoken.push(s),
    });
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    // First two deltas build a complete sentence ("First sentence. ").
    // The trailing space proves the boundary is closed and unlocks
    // the first onSpoken call.
    dispatchEvent!({ type: "text", delta: "First sentence" });
    expect(spoken).toEqual([]);
    dispatchEvent!({ type: "text", delta: ". " });
    expect(spoken).toEqual(["First sentence."]);

    // Next sentence streams in; doesn't flush until we see whitespace.
    dispatchEvent!({ type: "text", delta: "Second one." });
    expect(spoken).toEqual(["First sentence."]);
    dispatchEvent!({ type: "text", delta: " Third" });
    expect(spoken).toEqual(["First sentence.", "Second one."]);

    // Stream ends — tail should be flushed.
    dispatchEvent!({ type: "done", fullText: "First sentence. Second one. Third" });
    resolveStream?.();
    await turnPromise;

    expect(spoken).toEqual(["First sentence.", "Second one.", "Third"]);
  });

  it("flushes chunker remainder on tool action without merging across tool gap", async () => {
    const spoken: string[] = [];
    const turnPromise = runTurn({
      userText: "Research this",
      onSpoken: (s) => spoken.push(s),
    });
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    // No trailing space yet — not a complete sentence boundary.
    dispatchEvent!({ type: "text", delta: "Let me check quickly." });
    expect(spoken).toEqual([]);

    dispatchEvent!({
      type: "action",
      call: { id: "t-search", name: "web_search", input: { query: "test" } },
    });
    expect(spoken).toEqual(["Let me check quickly."]);

    dispatchEvent!({ type: "text", delta: "One moment. " });
    expect(spoken).toEqual(["Let me check quickly.", "One moment."]);

    dispatchEvent!({ type: "done", fullText: "Let me check quickly. One moment." });
    resolveStream?.();
    await turnPromise;

    for (const line of spoken) {
      expect(line).not.toMatch(/quickly\.One/i);
    }
  });

  it("continues speaking after tool calls between text bursts", async () => {
    const spoken: string[] = [];
    const turnPromise = runTurn({
      userText: "Drop a pin on Tacoma",
      onSpoken: (s) => spoken.push(s),
    });
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    // Burst 1: a complete sentence Seneca says before reaching for a tool.
    dispatchEvent!({ type: "text", delta: "Let me drop the pin. " });
    expect(spoken).toEqual(["Let me drop the pin."]);

    // A tool fires between text bursts.
    dispatchEvent!({
      type: "action",
      call: { id: "t-1", name: "drop_pin", input: { lat: 0, lng: 0 } },
    });
    // No new spoken chunk from a tool event.
    expect(spoken).toEqual(["Let me drop the pin."]);

    // Burst 2: more text continues to stream after the tool.
    dispatchEvent!({ type: "text", delta: "Pin is in. " });
    expect(spoken).toEqual(["Let me drop the pin.", "Pin is in."]);

    dispatchEvent!({ type: "done", fullText: "Let me drop the pin. Pin is in." });
    resolveStream?.();
    await turnPromise;

    expect(spoken).toEqual(["Let me drop the pin.", "Pin is in."]);
  });

  it("does not speak chunks again at the end", async () => {
    // Regression guard: we used to call onSpoken(fullText) at the end,
    // which would double-speak everything when combined with streaming.
    const spoken: string[] = [];
    const turnPromise = runTurn({
      userText: "Hi",
      onSpoken: (s) => spoken.push(s),
    });
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    dispatchEvent!({ type: "text", delta: "Hello there. " });
    dispatchEvent!({ type: "text", delta: "Good morning." });
    dispatchEvent!({
      type: "done",
      fullText: "Hello there. Good morning.",
    });
    resolveStream?.();
    await turnPromise;

    expect(spoken).toEqual(["Hello there.", "Good morning."]);
  });
});
