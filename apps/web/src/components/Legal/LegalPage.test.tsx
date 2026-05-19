/**
 * Privacy / terms placeholder pages.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { LegalPage } from "./LegalPage";

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

describe("LegalPage", () => {
  it("renders the privacy heading and at least one third-party processor", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <LegalPage kind="privacy" />
        </MemoryRouter>,
      );
    });
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Privacy");
    expect(container.textContent).toContain("Anthropic");
  });

  it("renders the terms heading and the MIT licence callout", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <LegalPage kind="terms" />
        </MemoryRouter>,
      );
    });
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toBe("Terms of Service");
    expect(container.textContent).toContain("MIT");
  });

  it("links back to the home page", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <LegalPage kind="privacy" />
        </MemoryRouter>,
      );
    });
    const back = container.querySelector('a[href="/"]');
    expect(back).not.toBeNull();
    expect(back?.textContent).toMatch(/Back to home/i);
  });
});
