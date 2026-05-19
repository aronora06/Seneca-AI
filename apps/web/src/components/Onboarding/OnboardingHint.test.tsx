/**
 * Phase F — onboarding hint tests.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { readPrefs, writePrefs } from "../../lib/userPreferences";
import { OnboardingHint } from "./OnboardingHint";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.removeItem("seneca:prefs");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  localStorage.removeItem("seneca:prefs");
});

function flush() {
  // The component renders after a one-tick effect; force a re-flush.
  act(() => {});
}

describe("OnboardingHint", () => {
  it("shows on first run", async () => {
    await act(async () => {
      root.render(<OnboardingHint />);
    });
    flush();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("hides after the dismiss button is clicked", async () => {
    await act(async () => {
      root.render(<OnboardingHint />);
    });
    flush();
    const dismiss = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Dismiss welcome message']",
    );
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss!.click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(readPrefs().onboardingDismissed).toBe(true);
  });

  it("does not show when onboardingDismissed is already true", async () => {
    writePrefs({ onboardingDismissed: true });
    await act(async () => {
      root.render(<OnboardingHint />);
    });
    flush();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
