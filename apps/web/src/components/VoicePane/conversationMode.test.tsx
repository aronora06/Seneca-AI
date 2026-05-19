/**
 * Phase G — Conversation Mode integration test.
 *
 * Drives the VoicePane's VAD-based conversation loop without actually
 * mounting the full pane (heavy with hooks, portals, drag handlers).
 * Instead we exercise the same wiring through a tiny harness component
 * that uses the real hooks and the real preference store, while
 * stubbing the external boundaries (MicVAD, runTurn).
 *
 * What we lock in:
 *
 *   - When conversationMode flips on, the VAD's start() is called.
 *   - When the VAD reports onSpeechStart during TTS playback, the
 *     active turn is aborted and TTS is cleared.
 *   - When the VAD reports onSpeechEnd and the textarea has content,
 *     runTurn is called after a short delay (recognizer tail).
 *   - When the VAD misfires, no submission happens.
 *   - Flipping conversationMode off tears down the VAD.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

import { writePrefs, usePrefs } from "../../lib/userPreferences";
import {
  cancelConversationModeSubmit,
  scheduleConversationModeSubmit,
} from "../../lib/conversationSubmit";
import { useConversationVad } from "../../hooks/useConversationVad";

// ── Mocks ──────────────────────────────────────────────────────────

interface FakeVad {
  start: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  updateOptions: ReturnType<typeof vi.fn>;
  triggerStart: () => void;
  triggerEnd: (audio: Float32Array) => void;
  triggerMisfire: () => void;
}

let fakeVad: FakeVad | null = null;

vi.mock("@ricky0123/vad-web", () => {
  return {
    MicVAD: {
      new: vi.fn(async (opts: Record<string, unknown>) => {
        const onStart = opts.onSpeechStart as (() => void) | undefined;
        const onEnd =
          opts.onSpeechEnd as
            | ((audio: Float32Array) => void)
            | undefined;
        const onMisfire = opts.onVADMisfire as (() => void) | undefined;
        const v: FakeVad = {
          start: vi.fn(),
          pause: vi.fn(),
          destroy: vi.fn(),
          updateOptions: vi.fn(),
          triggerStart: () => onStart?.(),
          triggerEnd: (audio) => onEnd?.(audio),
          triggerMisfire: () => onMisfire?.(),
        };
        fakeVad = v;
        return v;
      }),
    },
  };
});

const abortActiveTurnMock = vi.fn();
const ttsClearMock = vi.fn();
const submitMock = vi.fn();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface FakeTtsState {
  speaking: boolean;
}

/**
 * Minimal harness mirroring the VoicePane's conversation-mode wiring:
 *
 *   - Reads `prefs.conversationMode` from the real prefs store.
 *   - Owns a textarea ref that VAD onSpeechEnd will submit.
 *   - Routes the VAD callbacks through the same logic the pane does.
 */
function ConversationHarness(props: {
  initialText?: string;
  sttInterim?: string;
  tts: FakeTtsState;
  hasActiveTurn?: boolean;
}) {
  const prefs = usePrefs();
  const textRef = useRef(props.initialText ?? "");
  const interimRef = useRef(props.sttInterim ?? "");
  const vadSubmitTimer = useRef<number | null>(null);

  const vad = useConversationVad({
    onSpeechStart: () => {
      if (props.tts.speaking || props.hasActiveTurn) {
        ttsClearMock();
        abortActiveTurnMock("user_barge_in");
      }
      cancelConversationModeSubmit(vadSubmitTimer);
    },
    onSpeechEnd: () => {
      scheduleConversationModeSubmit({
        getPendingText: () => textRef.current,
        getSttInterim: () => interimRef.current,
        submit: (t) => submitMock(t),
        timer: vadSubmitTimer,
      });
    },
    onVadMisfire: () => {
      cancelConversationModeSubmit(vadSubmitTimer);
    },
  });

  useEffect(() => {
    if (!prefs.conversationMode) {
      vad.stop();
      return;
    }
    void vad.start();
  }, [prefs.conversationMode, vad]);

  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(
  props: {
    tts?: FakeTtsState;
    initialText?: string;
    sttInterim?: string;
    hasActiveTurn?: boolean;
  } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <ConversationHarness
        tts={props.tts ?? { speaking: false }}
        initialText={props.initialText}
        sttInterim={props.sttInterim}
        hasActiveTurn={props.hasActiveTurn}
      />,
    );
  });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  fakeVad = null;
  abortActiveTurnMock.mockReset();
  ttsClearMock.mockReset();
  submitMock.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("Conversation Mode loop", () => {
  it("starts the VAD when conversationMode is enabled", async () => {
    writePrefs({ conversationMode: true });
    mount();
    await act(async () => {
      // microtask drain so the inner async start() settles
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fakeVad).not.toBeNull();
    expect(fakeVad!.start).toHaveBeenCalled();
  });

  it("submits buffered text after VAD onSpeechEnd (with debounce)", async () => {
    vi.useFakeTimers();
    writePrefs({ conversationMode: true });
    mount({ initialText: "tell me about Marcus Aurelius" });
    // Drain the async start() with the real microtask queue, not fake timers.
    await act(async () => {
      vi.useRealTimers();
      await Promise.resolve();
      await Promise.resolve();
      vi.useFakeTimers();
    });
    expect(fakeVad).not.toBeNull();

    act(() => fakeVad!.triggerStart());
    expect(submitMock).not.toHaveBeenCalled();

    act(() => fakeVad!.triggerEnd(new Float32Array(0)));
    expect(submitMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(submitMock).toHaveBeenCalledWith("tell me about Marcus Aurelius");
    vi.useRealTimers();
  });

  it("triggers barge-in (clear TTS + abort turn) on speech-start during TTS", async () => {
    writePrefs({ conversationMode: true });
    mount({ tts: { speaking: true }, hasActiveTurn: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => fakeVad!.triggerStart());
    expect(ttsClearMock).toHaveBeenCalledTimes(1);
    expect(abortActiveTurnMock).toHaveBeenCalledWith("user_barge_in");
  });

  it("does NOT trigger barge-in when nothing is speaking and no turn is active", async () => {
    writePrefs({ conversationMode: true });
    mount({ tts: { speaking: false }, hasActiveTurn: false });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => fakeVad!.triggerStart());
    expect(ttsClearMock).not.toHaveBeenCalled();
    expect(abortActiveTurnMock).not.toHaveBeenCalled();
  });

  it("cancels a pending submit when speech restarts inside the debounce window", async () => {
    vi.useFakeTimers();
    writePrefs({ conversationMode: true });
    mount({ initialText: "hi" });
    await act(async () => {
      vi.useRealTimers();
      await Promise.resolve();
      await Promise.resolve();
      vi.useFakeTimers();
    });

    act(() => fakeVad!.triggerStart());
    act(() => fakeVad!.triggerEnd(new Float32Array(0)));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // User started talking again inside the 280ms window — submit cancelled.
    act(() => fakeVad!.triggerStart());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(submitMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("a misfire clears the pending submission timer", async () => {
    vi.useFakeTimers();
    writePrefs({ conversationMode: true });
    mount({ initialText: "hello" });
    await act(async () => {
      vi.useRealTimers();
      await Promise.resolve();
      await Promise.resolve();
      vi.useFakeTimers();
    });
    act(() => fakeVad!.triggerStart());
    act(() => fakeVad!.triggerEnd(new Float32Array(0)));
    act(() => fakeVad!.triggerMisfire());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(submitMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("stops the VAD when conversationMode flips off", async () => {
    writePrefs({ conversationMode: true });
    mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const v = fakeVad!;
    act(() => {
      writePrefs({ conversationMode: false });
    });
    expect(v.pause).toHaveBeenCalled();
    expect(v.destroy).toHaveBeenCalled();
  });
});
