/**
 * Phase B — silence-detection unit tests for useSpeechRecognition.
 *
 * happy-dom doesn't ship SpeechRecognition, so we install a tiny mock
 * on `window` for the duration of the test. The mock surfaces `start`,
 * `stop`, `abort`, and lets the test fire fake `onresult` / `onend`
 * events. The hook reads everything else through stable callbacks.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  useSpeechRecognition,
  type SpeechRecognitionHook,
} from "./useSpeechRecognition";

class MockSpeechRecognition {
  lang = "en-US";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  started = false;

  start = vi.fn(() => {
    this.started = true;
    this.onstart?.();
  });

  stop = vi.fn(() => {
    if (!this.started) return;
    this.started = false;
    this.onend?.();
  });

  abort = vi.fn(() => {
    this.started = false;
    this.onend?.();
  });

  fireResult(parts: Array<{ text: string; isFinal: boolean }>) {
    const results: SpeechRecognitionResult[] = parts.map((part) => {
      const alt: SpeechRecognitionAlternative = {
        transcript: part.text,
        confidence: 0.9,
      };
      const result = {
        0: alt,
        length: 1,
        isFinal: part.isFinal,
        item: (i: number) => (i === 0 ? alt : alt),
      } as unknown as SpeechRecognitionResult;
      return result;
    });
    const ev = {
      resultIndex: 0,
      results: results as unknown as SpeechRecognitionResultList,
    } as SpeechRecognitionEvent;
    this.onresult?.(ev);
  }
}

let mockInstance: MockSpeechRecognition | null = null;

beforeEach(() => {
  mockInstance = null;
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
    function () {
      const m = new MockSpeechRecognition();
      mockInstance = m;
      return m;
    };
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown })
    .webkitSpeechRecognition;
  vi.useRealTimers();
});

interface ProbeOpts {
  onFinal?: (text: string) => void;
  onInterim?: (text: string) => void;
  onSilence?: () => void;
  silenceMs?: number;
  onHook?: (h: SpeechRecognitionHook) => void;
}

function renderProbe(opts: ProbeOpts): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Probe {...opts} />);
  });
  return { container, root };
}

function Probe(opts: ProbeOpts) {
  const hook = useSpeechRecognition({
    onFinal: opts.onFinal ?? (() => undefined),
    onInterim: opts.onInterim,
    onSilence: opts.onSilence,
    silenceMs: opts.silenceMs,
  });
  useEffect(() => {
    opts.onHook?.(hook);
  });
  return null;
}

describe("useSpeechRecognition — silence detection", () => {
  it("fires onSilence after the configured quiet period following a final result", () => {
    vi.useFakeTimers();
    const onFinal = vi.fn();
    const onSilence = vi.fn();

    let captured: SpeechRecognitionHook | null = null;
    renderProbe({
      onFinal,
      onSilence,
      silenceMs: 1500,
      onHook: (h) => {
        captured = h;
      },
    });

    act(() => {
      captured!.start();
    });
    expect(mockInstance).not.toBeNull();

    act(() => {
      mockInstance!.fireResult([{ text: "hello world", isFinal: true }]);
    });
    expect(onFinal).toHaveBeenCalledWith("hello world");
    expect(onSilence).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("resets the silence timer when a new interim chunk arrives mid-quiet-period", () => {
    vi.useFakeTimers();
    const onSilence = vi.fn();

    let captured: SpeechRecognitionHook | null = null;
    renderProbe({
      onSilence,
      silenceMs: 1500,
      onHook: (h) => {
        captured = h;
      },
    });

    act(() => {
      captured!.start();
      mockInstance!.fireResult([{ text: "first", isFinal: true }]);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSilence).not.toHaveBeenCalled();

    // Interim chunk extends the silence window.
    act(() => {
      mockInstance!.fireResult([{ text: "still going", isFinal: false }]);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onSilence).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("does not fire onSilence when no final result has landed", () => {
    vi.useFakeTimers();
    const onSilence = vi.fn();

    let captured: SpeechRecognitionHook | null = null;
    renderProbe({
      onSilence,
      silenceMs: 1500,
      onHook: (h) => {
        captured = h;
      },
    });

    act(() => {
      captured!.start();
      mockInstance!.fireResult([{ text: "uhh", isFinal: false }]);
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onSilence).not.toHaveBeenCalled();
  });

  it("disables silence detection when silenceMs is 0", () => {
    vi.useFakeTimers();
    const onSilence = vi.fn();

    let captured: SpeechRecognitionHook | null = null;
    renderProbe({
      onSilence,
      silenceMs: 0,
      onHook: (h) => {
        captured = h;
      },
    });

    act(() => {
      captured!.start();
      mockInstance!.fireResult([{ text: "done", isFinal: true }]);
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onSilence).not.toHaveBeenCalled();
  });

  it("fires onInterim with every interim update and clears it on final", () => {
    vi.useFakeTimers();
    const onInterim = vi.fn();
    const onFinal = vi.fn();

    let captured: SpeechRecognitionHook | null = null;
    renderProbe({
      onFinal,
      onInterim,
      onHook: (h) => {
        captured = h;
      },
    });

    act(() => {
      captured!.start();
      mockInstance!.fireResult([{ text: "hel", isFinal: false }]);
    });
    expect(onInterim).toHaveBeenLastCalledWith("hel");

    act(() => {
      mockInstance!.fireResult([{ text: "hello", isFinal: false }]);
    });
    expect(onInterim).toHaveBeenLastCalledWith("hello");

    act(() => {
      mockInstance!.fireResult([{ text: "hello", isFinal: true }]);
    });
    expect(onInterim).toHaveBeenLastCalledWith("");
    expect(onFinal).toHaveBeenCalledWith("hello");
  });
});
