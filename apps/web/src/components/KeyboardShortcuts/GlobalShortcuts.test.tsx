/**
 * Phase G — global "C" shortcut for Conversation Mode.
 *
 * What we lock in:
 *
 *   - Pressing C while no editable element is focused toggles the
 *     `conversationMode` preference and sets
 *     `conversationModeHintDismissed` to true (so the onboarding
 *     hint doesn't reappear after the user took the shortcut).
 *   - The shortcut is ignored while typing in an input / textarea /
 *     contenteditable.
 *   - The shortcut is ignored when any modifier key is pressed (so
 *     Cmd+C copy and Ctrl+C cancel keep working).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { GlobalShortcuts } from "./GlobalShortcuts";
import { readPrefs, writePrefs } from "../../lib/userPreferences";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<GlobalShortcuts />);
  });
}

function press(
  key: string,
  opts: { target?: EventTarget } & Partial<KeyboardEventInit> = {},
) {
  const { target, ...init } = opts;
  const ev = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (target) {
    target.dispatchEvent(ev);
  } else {
    window.dispatchEvent(ev);
  }
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

describe("GlobalShortcuts — C toggles Conversation Mode", () => {
  it("flips conversationMode on when pressed bare", () => {
    mount();
    expect(readPrefs().conversationMode).toBe(false);
    act(() => press("c"));
    expect(readPrefs().conversationMode).toBe(true);
    expect(readPrefs().conversationModeHintDismissed).toBe(true);
  });

  it("flips it back off on a second press", () => {
    writePrefs({ conversationMode: true });
    mount();
    act(() => press("c"));
    expect(readPrefs().conversationMode).toBe(false);
  });

  it("does NOT fire when focus is in a text input", () => {
    mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => press("c", { target: input }));
    expect(readPrefs().conversationMode).toBe(false);
    input.remove();
  });

  it("does NOT fire when meta or ctrl is held (lets Cmd+C copy survive)", () => {
    mount();
    act(() => press("c", { metaKey: true }));
    expect(readPrefs().conversationMode).toBe(false);
    act(() => press("c", { ctrlKey: true }));
    expect(readPrefs().conversationMode).toBe(false);
  });

  it("ignores key repeats so a held key doesn't oscillate", () => {
    mount();
    act(() => press("c", { repeat: true }));
    expect(readPrefs().conversationMode).toBe(false);
  });
});
