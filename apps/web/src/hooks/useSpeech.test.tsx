/**
 * Phase C — speech facade tests.
 *
 * Covers two paths:
 *   1. ElevenLabs available → useSpeech picks the premium hook.
 *   2. ElevenLabs not available (or user forced "browser") → useSpeech
 *      falls back to the browser SpeechSynthesisUtterance path.
 *
 * Also asserts the config probe is cached so re-mounts don't refire
 * the request.
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
  __setSpeechConfigForTests,
  fetchTtsConfig,
  useSpeech,
  type SpeechHook,
} from "./useSpeech";
import { writePrefs } from "../lib/userPreferences";

let container: HTMLDivElement;
let root: Root;
let captured: SpeechHook | null;

function Probe() {
  const hook = useSpeech();
  useEffect(() => {
    captured = hook;
  });
  return null;
}

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
}

beforeEach(() => {
  captured = null;
  __setSpeechConfigForTests(null);
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // ignore
  }
});

afterEach(() => {
  __setSpeechConfigForTests(null);
  if (root) {
    act(() => {
      root.unmount();
    });
  }
  if (container) container.remove();
});

describe("useSpeech facade", () => {
  it("falls back to the browser engine when ElevenLabs is unavailable", async () => {
    __setSpeechConfigForTests({
      available: false,
      defaultVoiceId: null,
      modelId: null,
      voices: [],
    });
    render();
    await act(async () => {
      await flushPromises();
    });
    expect(captured!.engine).toBe("browser");
    expect(captured!.voices).toEqual([]);
  });

  it("uses the ElevenLabs engine when available and provider=auto", async () => {
    __setSpeechConfigForTests({
      available: true,
      defaultVoiceId: "v_default",
      modelId: "eleven_turbo_v2_5",
      voices: [
        { id: "v_default", name: "Brian", description: "Default voice" },
        { id: "v_other", name: "Adam", description: "Other voice" },
      ],
    });
    writePrefs({ ttsProvider: "auto" });
    render();
    await act(async () => {
      await flushPromises();
    });
    expect(captured!.engine).toBe("elevenlabs");
    expect(captured!.voices.length).toBe(2);
  });

  it("respects the browser-forced provider override even when ElevenLabs is available", async () => {
    __setSpeechConfigForTests({
      available: true,
      defaultVoiceId: "v_default",
      modelId: "eleven_turbo_v2_5",
      voices: [{ id: "v_default", name: "Brian", description: "" }],
    });
    writePrefs({ ttsProvider: "browser" });
    render();
    await act(async () => {
      await flushPromises();
    });
    expect(captured!.engine).toBe("browser");
  });
});

describe("fetchTtsConfig caching", () => {
  it("calls fetch only once across repeated invocations", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            available: true,
            defaultVoiceId: "v1",
            modelId: "eleven_turbo_v2_5",
            voices: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    // Reset the in-module cache: force=true clears the promise and
    // sessionStorage.
    await fetchTtsConfig(true);
    await fetchTtsConfig();
    await fetchTtsConfig();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

async function flushPromises(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}
