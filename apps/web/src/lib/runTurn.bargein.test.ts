/**
 * Phase F follow-up — barge-in tests for `runTurn`.
 *
 * Locks in the contract that an `AbortController.abort()` from the
 * voice pane (triggered by `abortActiveTurn()`) cleanly cancels the
 * in-flight chat stream and commits a truncated, `interrupted: true`
 * assistant turn to the transcript — no "request failed" notice.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSenecaStore } from "../store/seneca";

// Mock the api layer so we can drive a synthetic SSE stream.
let dispatchEvent: ((e: unknown) => void) | null = null;
let resolveStream: ((value: void) => void) | null = null;
let rejectStream: ((reason: unknown) => void) | null = null;
let lastSignal: AbortSignal | null = null;

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
        lastSignal = handlers.signal ?? null;
        return new Promise<void>((resolve, reject) => {
          resolveStream = resolve;
          rejectStream = reject;
          handlers.signal?.addEventListener("abort", () => {
            const err = new DOMException("aborted", "AbortError");
            reject(err);
          });
        });
      },
    ),
  };
});

vi.mock("./captureCanvas", () => ({
  captureActiveTab: vi.fn().mockResolvedValue(null),
}));

vi.mock("./actionDispatcher", () => ({
  // Default: tool dispatch is async and resolves successfully.
  // Individual tests can override per-call via `mockImplementationOnce`.
  dispatchToolCall: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./userPreferences", () => ({
  readPrefs: () => ({
    customInstructions: { aboutYou: "", howToRespond: "" },
    visionDefault: "off",
  }),
}));

import { abortActiveTurn, runTurn } from "./runTurn";

beforeEach(() => {
  dispatchEvent = null;
  resolveStream = null;
  rejectStream = null;
  lastSignal = null;
  // Reset the store to a clean state with a real session id so
  // `runTurn` proceeds past its guards.
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

describe("runTurn barge-in", () => {
  it("commits a truncated interrupted assistant message on abort", async () => {
    const turnPromise = runTurn({ userText: "Tell me a long story" });
    // Wait for the apiStream mock to attach.
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    // Simulate a few text chunks arriving from the server.
    dispatchEvent!({ type: "text", delta: "Long ago in a quiet" });
    dispatchEvent!({ type: "text", delta: " corner of Rome" });

    // User barges in.
    abortActiveTurn("test_barge");

    await turnPromise;

    const transcript = useSenecaStore.getState().transcript;
    const senecaTurn = transcript.find((m) => m.role === "seneca");
    expect(senecaTurn).toBeDefined();
    expect(senecaTurn!.text).toBe("Long ago in a quiet corner of Rome");
    expect(senecaTurn!.interrupted).toBe(true);
    // No system error notice should have been appended.
    const systemErrors = transcript.filter((m) => m.role === "system");
    expect(systemErrors).toHaveLength(0);
    expect(rejectStream).not.toBeNull();
    expect(lastSignal?.aborted).toBe(true);
  });

  it("does not commit an interrupted message when no text streamed", async () => {
    const turnPromise = runTurn({ userText: "Hi" });
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    // Abort immediately before any text arrives.
    abortActiveTurn();

    await turnPromise;

    const transcript = useSenecaStore.getState().transcript;
    const senecaTurn = transcript.find((m) => m.role === "seneca");
    expect(senecaTurn).toBeUndefined();
  });

  it("persists tool_use blocks on an interrupted message so the next turn's tool_results have a matching tool_use", async () => {
    // Regression for:
    //   400 messages.N.content.0: unexpected `tool_use_id` found in
    //   `tool_result` blocks. Each `tool_result` block must have a
    //   corresponding `tool_use` block in the previous message.
    //
    // Sequence: model emits a tool_use, then some text, then the
    // user barges in. The local tool dispatch finishes asynchronously
    // and enqueues a `tool_result` for the NEXT turn. The committed
    // interrupted assistant message must carry the tool_use so the
    // server's buildAnthropicMessages can echo it back to Anthropic.
    const turnPromise = runTurn({ userText: "Tell me about Frank Herbert" });
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    // Model emits a tool_use block (web_search) then starts speaking.
    dispatchEvent!({
      type: "action",
      call: {
        id: "toolu_test_abc",
        name: "web_search",
        input: { query: "Frank Herbert author" },
      },
    });
    dispatchEvent!({ type: "text", delta: "Let me pull up some info" });

    abortActiveTurn("test_barge_with_tool");
    await turnPromise;

    const senecaTurn = useSenecaStore
      .getState()
      .transcript.find((m) => m.role === "seneca");
    expect(senecaTurn).toBeDefined();
    expect(senecaTurn!.interrupted).toBe(true);
    expect(senecaTurn!.tools).toBeDefined();
    expect(senecaTurn!.tools).toHaveLength(1);
    expect(senecaTurn!.tools![0]!.id).toBe("toolu_test_abc");
    expect(senecaTurn!.tools![0]!.name).toBe("web_search");
  });

  it("commits a tools-only interrupted message when abort lands before any text streamed", async () => {
    // Edge case: model emits a tool_use, dispatch starts, user barges
    // in before the first text delta. We still need to record the
    // assistant turn so its tool_use blocks survive into history.
    const turnPromise = runTurn({ userText: "Show me the map" });
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    dispatchEvent!({
      type: "action",
      call: {
        id: "toolu_test_xyz",
        name: "fly_to",
        input: { lat: 0, lng: 0, zoom: 5 },
      },
    });

    abortActiveTurn("test_barge_tools_only");
    await turnPromise;

    const senecaTurn = useSenecaStore
      .getState()
      .transcript.find((m) => m.role === "seneca");
    expect(senecaTurn).toBeDefined();
    expect(senecaTurn!.text).toBe("");
    expect(senecaTurn!.interrupted).toBe(true);
    expect(senecaTurn!.tools).toHaveLength(1);
    expect(senecaTurn!.tools![0]!.id).toBe("toolu_test_xyz");
  });

  it("annotates interrupted messages with the marker on subsequent turns", async () => {
    // Pre-seed an interrupted message in the transcript.
    useSenecaStore.setState((s) => ({
      ...s,
      transcript: [
        ...s.transcript,
        {
          id: "u-1",
          role: "user",
          text: "First question",
          ts: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "a-1",
          role: "seneca",
          text: "I was just about to say something",
          ts: "2024-01-01T00:00:01.000Z",
          interrupted: true,
        },
      ],
    }));

    const turnPromise = runTurn({ userText: "Wait, actually..." });
    await vi.waitFor(() => expect(dispatchEvent).not.toBeNull());

    // The apiStream mock is shared across tests so use `lastCall`
    // to inspect the body our `runTurn` just sent.
    const apiMod = await import("./api");
    const apiStreamMock = apiMod.apiStream as ReturnType<typeof vi.fn>;
    const sentBody = apiStreamMock.mock.lastCall?.[1] as {
      messages: { role: string; text: string; interrupted?: boolean }[];
    };
    const senecaMsg = sentBody.messages.find(
      (m) => m.role === "seneca",
    );
    expect(senecaMsg).toBeDefined();
    expect(senecaMsg!.text).toContain("[... user interrupted me here]");

    // Cleanly resolve the stream so the test doesn't hang.
    dispatchEvent!({ type: "done", fullText: "ok" });
    resolveStream?.();
    await turnPromise;
  });
});
