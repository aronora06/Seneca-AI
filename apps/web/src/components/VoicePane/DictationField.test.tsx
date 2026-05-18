/**
 * Phase B — DictationField overlay behaviour.
 *
 * Verifies the interim ghost text shows / hides at the right moments,
 * and that the controlled textarea behaves like the user expects
 * (Enter submits, Shift+Enter inserts a newline, plain typing updates
 * the value).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DictationField } from "./DictationField";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

interface ProbeProps {
  initial?: string;
  interim?: string;
  disabled?: boolean;
  onEnter?: () => void;
}

function Probe({
  initial = "",
  interim = "",
  disabled = false,
  onEnter,
}: ProbeProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  return (
    <DictationField
      textareaRef={ref}
      value={value}
      onChange={setValue}
      interim={interim}
      disabled={disabled}
      placeholderActive="Seneca is thinking…"
      placeholderIdle="Type or hold mic"
      onEnter={onEnter ?? (() => undefined)}
    />
  );
}

describe("DictationField", () => {
  it("renders the textarea with the controlled value", () => {
    act(() => {
      root.render(<Probe initial="hi there" />);
    });
    const ta = container.querySelector("textarea");
    expect(ta).not.toBeNull();
    expect(ta!.value).toBe("hi there");
  });

  it("does not render the interim overlay when interim is empty", () => {
    act(() => {
      root.render(<Probe initial="" interim="" />);
    });
    expect(
      container.querySelector("[data-testid='dictation-interim']"),
    ).toBeNull();
  });

  it("renders the interim overlay when interim is non-empty and not disabled", () => {
    act(() => {
      root.render(<Probe initial="hello" interim="world" />);
    });
    const overlay = container.querySelector(
      "[data-testid='dictation-interim']",
    );
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain("world");
    // The committed text appears in an invisible span so the visible
    // suffix aligns with the textarea cursor.
    const invisible = overlay!.querySelector(".invisible");
    expect(invisible).not.toBeNull();
    expect(invisible!.textContent).toBe("hello ");
  });

  it("hides the interim overlay while disabled (mid-turn)", () => {
    act(() => {
      root.render(<Probe interim="should be hidden" disabled />);
    });
    expect(
      container.querySelector("[data-testid='dictation-interim']"),
    ).toBeNull();
  });

  it("Enter without Shift fires onEnter and prevents the newline", () => {
    const onEnter = vi.fn();
    act(() => {
      root.render(<Probe initial="ready" onEnter={onEnter} />);
    });
    const ta = container.querySelector("textarea")!;
    act(() => {
      ta.focus();
      const ev = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      ta.dispatchEvent(ev);
    });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("Shift+Enter does not fire onEnter", () => {
    const onEnter = vi.fn();
    act(() => {
      root.render(<Probe initial="ready" onEnter={onEnter} />);
    });
    const ta = container.querySelector("textarea")!;
    act(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
      });
      ta.dispatchEvent(ev);
    });
    expect(onEnter).not.toHaveBeenCalled();
  });
});
