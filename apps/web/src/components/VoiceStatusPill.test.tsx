import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useSenecaStore } from "../store/seneca";
import { VoiceStatusPill } from "./VoiceStatusPill";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<VoiceStatusPill />);
  });
}

beforeEach(() => {
  useSenecaStore.setState((s) => ({
    voice: {
      ...s.voice,
      activityPhase: "idle",
      activityLabel: null,
    },
  }));
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("VoiceStatusPill", () => {
  it("renders nothing when idle", () => {
    mount();
    expect(container!.textContent).toBe("");
  });

  it("shows a status region with aria-label when active", () => {
    useSenecaStore.setState((s) => ({
      voice: {
        ...s.voice,
        activityPhase: "senecaStreaming",
        activityLabel: "Seneca is writing",
      },
    }));
    mount();
    const pill = container!.querySelector('[role="status"]');
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("aria-label")).toBe("Seneca is writing");
  });

  it("hides visible label below sm breakpoint", () => {
    useSenecaStore.setState((s) => ({
      voice: {
        ...s.voice,
        activityPhase: "userDictating",
        activityLabel: "Hearing you",
      },
    }));
    mount();
    const visibleLabel = container!.querySelector(".hidden.sm\\:inline");
    expect(visibleLabel).not.toBeNull();
    expect(visibleLabel!.textContent).toBe("Hearing you");
  });

  it("uses a static dot when reduced motion is preferred", () => {
    useSenecaStore.setState((s) => ({
      voice: {
        ...s.voice,
        activityPhase: "senecaThinking",
        activityLabel: "Seneca is thinking",
      },
    }));
    mount();
    const dot = container!.querySelector(".rounded-full");
    expect(dot?.className).not.toContain("animate-pulse");
  });
});
