/**
 * Phase A — segmented-control unit tests.
 *
 * We mount the component into happy-dom directly (no @testing-library
 * dep) so the test stays in step with the rest of the workspace's
 * lightweight harness. The component reads + writes the Zustand store
 * directly, so we assert against the store after each interaction.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { useSenecaStore } from "../../store/seneca";
import { VisionToggle } from "./VisionToggle";

let container: HTMLDivElement;
let root: Root;

function render(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<VisionToggle />);
  });
}

function getSegment(mode: "off" | "once" | "locked"): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    `[data-vision-mode="${mode}"]`,
  );
  if (!el) throw new Error(`segment "${mode}" not found in render output`);
  return el;
}

beforeEach(() => {
  useSenecaStore.setState({ vision: { enabled: false, pinned: false } });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("VisionToggle — segmented control", () => {
  it("renders three radio buttons with the off segment selected by default", () => {
    render();
    expect(getSegment("off").getAttribute("aria-checked")).toBe("true");
    expect(getSegment("once").getAttribute("aria-checked")).toBe("false");
    expect(getSegment("locked").getAttribute("aria-checked")).toBe("false");
  });

  it("clicking a segment commits the matching VisionMode", () => {
    render();
    act(() => {
      getSegment("locked").click();
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: true,
    });
    expect(getSegment("locked").getAttribute("aria-checked")).toBe("true");
  });

  it("ArrowRight cycles forward (off → once → locked → off)", () => {
    render();

    act(() => {
      getSegment("off").focus();
      getSegment("off").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: false,
    });

    act(() => {
      getSegment("once").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: true,
    });

    act(() => {
      getSegment("locked").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: false,
      pinned: false,
    });
  });

  it("ArrowLeft cycles backward (off → locked → once → off)", () => {
    render();

    act(() => {
      getSegment("off").focus();
      getSegment("off").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: true,
    });

    act(() => {
      getSegment("locked").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: false,
    });
  });

  it("Home jumps to off; End jumps to locked", () => {
    useSenecaStore.setState({ vision: { enabled: true, pinned: false } });
    render();

    act(() => {
      getSegment("once").focus();
      getSegment("once").dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: true,
      pinned: true,
    });

    act(() => {
      getSegment("locked").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: false,
      pinned: false,
    });
  });

  it("ignores unrelated keys without changing state", () => {
    render();
    act(() => {
      getSegment("off").focus();
      getSegment("off").dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
    });
    expect(useSenecaStore.getState().vision).toEqual({
      enabled: false,
      pinned: false,
    });
  });
});
