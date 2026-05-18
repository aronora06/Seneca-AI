/**
 * Phase B — Waveform / useMicAnalyser cleanup.
 *
 * happy-dom doesn't ship the Web Audio API, so we install a minimal
 * mock that records `close()` / `track.stop()` calls. Then we assert
 * that flipping `active` to false (or unmounting) tears down every
 * resource — no leaked AudioContext, no leaked MediaStream, no leaked
 * mic indicator.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { useMicAnalyser } from "./useMicAnalyser";

let trackStops: number;
let contextCloses: number;
let mediaStreamResolve: ((value: MediaStream) => void) | null;

class FakeAnalyser {
  fftSize = 256;
  smoothingTimeConstant = 0.6;
  frequencyBinCount = 128;
  getByteTimeDomainData = vi.fn();
  getByteFrequencyData = vi.fn();
  disconnect = vi.fn();
}

class FakeSource {
  connect = vi.fn();
}

class FakeAudioContext {
  state: AudioContextState = "running";
  createMediaStreamSource = vi.fn(() => new FakeSource());
  createAnalyser = vi.fn(() => new FakeAnalyser());
  close = vi.fn(() => {
    contextCloses += 1;
    this.state = "closed";
    return Promise.resolve();
  });
}

class FakeTrack {
  stop = vi.fn(() => {
    trackStops += 1;
  });
}

class FakeMediaStream {
  private tracks: FakeTrack[] = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

beforeEach(() => {
  trackStops = 0;
  contextCloses = 0;
  mediaStreamResolve = null;

  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(
        () =>
          new Promise<MediaStream>((resolve) => {
            mediaStreamResolve = resolve;
          }),
      ),
    },
  });
});

afterEach(() => {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  // best-effort cleanup; happy-dom regenerates `navigator` between tests
});

function Probe({ active }: { active: boolean }) {
  useMicAnalyser({ active });
  return null;
}

async function flushPromises() {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("useMicAnalyser — cleanup discipline", () => {
  it("stops every track and closes the AudioContext when active flips false", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<Probe active={true} />);
    });

    // Resolve the mic-acquisition promise so the hook wires up.
    mediaStreamResolve?.(new FakeMediaStream() as unknown as MediaStream);
    await act(async () => {
      await flushPromises();
    });

    // Flip active off; cleanup should run synchronously.
    act(() => {
      root.render(<Probe active={false} />);
    });

    expect(trackStops).toBe(1);
    expect(contextCloses).toBe(1);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("does nothing (no mic prompt) while active is false", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const spy = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;

    act(() => {
      root.render(<Probe active={false} />);
    });
    await flushPromises();

    expect(spy).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("tears down resources when the component unmounts mid-stream", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<Probe active={true} />);
    });
    mediaStreamResolve?.(new FakeMediaStream() as unknown as MediaStream);
    await act(async () => {
      await flushPromises();
    });

    act(() => {
      root.unmount();
    });
    container.remove();

    expect(trackStops).toBe(1);
    expect(contextCloses).toBe(1);
  });
});
