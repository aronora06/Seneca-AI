/**
 * Phase F — keyboard shortcut overlay tests.
 *
 * Asserts the Cmd/Ctrl+/ binding toggles the overlay and Escape
 * closes it.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShortcutOverlay } from "./ShortcutOverlay";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ShortcutOverlay />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function dispatchKey(opts: KeyboardEventInit): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", opts));
  });
}

describe("ShortcutOverlay", () => {
  it("is hidden by default", () => {
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens on Ctrl+/ and closes on Escape", () => {
    dispatchKey({ key: "/", ctrlKey: true });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    dispatchKey({ key: "Escape" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens on Cmd+/ for mac", () => {
    dispatchKey({ key: "/", metaKey: true });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("toggles when the shortcut is pressed twice", () => {
    dispatchKey({ key: "/", ctrlKey: true });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    dispatchKey({ key: "/", ctrlKey: true });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders at least one shortcut group", () => {
    dispatchKey({ key: "/", ctrlKey: true });
    const headings = container.querySelectorAll("h3");
    expect(headings.length).toBeGreaterThan(0);
  });
});
