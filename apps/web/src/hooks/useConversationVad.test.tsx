/**
 * useConversationVad lifecycle tests.
 *
 * We mock `@ricky0123/vad-web` because the real package downloads an
 * ONNX model + a WASM runtime at start() time and spins up an
 * AudioWorklet, neither of which happy-dom has any business doing.
 * The mock surfaces a `MicVAD.new` that returns a controllable
 * instance and lets the test drive `onSpeechStart` / `onSpeechEnd`
 * synchronously.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  useConversationVad,
  type ConversationVadHook,
} from "./useConversationVad";

interface FakeInstance {
  start: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  updateOptions: ReturnType<typeof vi.fn>;
  triggerStart: () => void;
  triggerEnd: (audio: Float32Array) => void;
  triggerMisfire: () => void;
  capturedOptions: Record<string, unknown>;
}

let fakeInstance: FakeInstance | null = null;
let initShouldThrow: Error | null = null;

vi.mock("@ricky0123/vad-web", () => {
  return {
    MicVAD: {
      new: vi.fn(async (opts: Record<string, unknown>) => {
        if (initShouldThrow) throw initShouldThrow;
        const onStart = opts.onSpeechStart as (() => void) | undefined;
        const onEnd =
          opts.onSpeechEnd as
            | ((audio: Float32Array) => void)
            | undefined;
        const onMisfire = opts.onVADMisfire as (() => void) | undefined;
        const inst: FakeInstance = {
          start: vi.fn(),
          pause: vi.fn(),
          destroy: vi.fn(),
          updateOptions: vi.fn(),
          triggerStart: () => onStart?.(),
          triggerEnd: (audio) => onEnd?.(audio),
          triggerMisfire: () => onMisfire?.(),
          capturedOptions: opts,
        };
        fakeInstance = inst;
        return inst;
      }),
    },
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface ProbeOpts {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onVadMisfire?: () => void;
  onHook?: (h: ConversationVadHook) => void;
  positiveSpeechThreshold?: number;
}

function Probe(opts: ProbeOpts) {
  const hook = useConversationVad({
    onSpeechStart: opts.onSpeechStart,
    onSpeechEnd: opts.onSpeechEnd,
    onVadMisfire: opts.onVadMisfire,
    positiveSpeechThreshold: opts.positiveSpeechThreshold,
  });
  useEffect(() => {
    opts.onHook?.(hook);
  });
  return null;
}

function renderProbe(opts: ProbeOpts): { root: Root; container: HTMLDivElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Probe {...opts} />);
  });
  return { root, container };
}

beforeEach(() => {
  fakeInstance = null;
  initShouldThrow = null;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useConversationVad", () => {
  it("starts the model and fires onSpeechStart / onSpeechEnd through the hook", async () => {
    const onSpeechStart = vi.fn();
    const onSpeechEnd = vi.fn();
    let captured: ConversationVadHook | null = null;
    renderProbe({
      onSpeechStart,
      onSpeechEnd,
      onHook: (h) => {
        captured = h;
      },
    });

    let result: { ok: boolean } | undefined;
    await act(async () => {
      result = await captured!.start();
    });
    expect(result?.ok).toBe(true);
    expect(fakeInstance).not.toBeNull();
    expect(fakeInstance!.start).toHaveBeenCalled();

    act(() => fakeInstance!.triggerStart());
    expect(onSpeechStart).toHaveBeenCalledTimes(1);

    const audio = new Float32Array([0.1, 0.2, 0.3]);
    act(() => fakeInstance!.triggerEnd(audio));
    expect(onSpeechEnd).toHaveBeenCalledWith(audio);
  });

  it("returns ok=false with the error message when the model fails to load", async () => {
    initShouldThrow = new Error("network offline");
    let captured: ConversationVadHook | null = null;
    renderProbe({
      onHook: (h) => {
        captured = h;
      },
    });

    let result: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      result = await captured!.start();
    });
    expect(result?.ok).toBe(false);
    expect(result && "error" in result ? result.error : "").toContain(
      "network offline",
    );
  });

  it("forwards onVadMisfire and clears isSpeaking", async () => {
    const onMisfire = vi.fn();
    let captured: ConversationVadHook | null = null;
    renderProbe({
      onVadMisfire: onMisfire,
      onHook: (h) => {
        captured = h;
      },
    });
    await act(async () => {
      await captured!.start();
    });
    act(() => fakeInstance!.triggerStart());
    act(() => fakeInstance!.triggerMisfire());
    expect(onMisfire).toHaveBeenCalled();
  });

  it("stop() pauses + destroys the instance", async () => {
    let captured: ConversationVadHook | null = null;
    renderProbe({
      onHook: (h) => {
        captured = h;
      },
    });
    await act(async () => {
      await captured!.start();
    });
    const inst = fakeInstance!;
    act(() => {
      captured!.stop();
    });
    expect(inst.pause).toHaveBeenCalled();
    expect(inst.destroy).toHaveBeenCalled();
  });

  it("setActivationThreshold updates positive + negative thresholds proportionally", async () => {
    let captured: ConversationVadHook | null = null;
    renderProbe({
      positiveSpeechThreshold: 0.5,
      onHook: (h) => {
        captured = h;
      },
    });
    await act(async () => {
      await captured!.start();
    });
    act(() => {
      captured!.setActivationThreshold(0.8);
    });
    expect(fakeInstance!.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        positiveSpeechThreshold: 0.8,
        negativeSpeechThreshold: expect.any(Number),
      }),
    );
    const args = fakeInstance!.updateOptions.mock.lastCall?.[0] as {
      negativeSpeechThreshold: number;
    };
    expect(args.negativeSpeechThreshold).toBeLessThan(0.8);
  });

  it("releases the instance on unmount", async () => {
    let captured: ConversationVadHook | null = null;
    const handle = renderProbe({
      onHook: (h) => {
        captured = h;
      },
    });
    await act(async () => {
      await captured!.start();
    });
    const inst = fakeInstance!;
    act(() => {
      handle.root.unmount();
    });
    expect(inst.destroy).toHaveBeenCalled();
  });
});
