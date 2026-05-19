import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { PricingPage } from "./PricingPage";

vi.mock("../../lib/devBypass", () => ({
  devBypassAuth: false,
}));

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

describe("PricingPage", () => {
  it("renders the pricing headline and three plans", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <PricingPage />
        </MemoryRouter>,
      );
    });

    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toMatch(/Honest about costs\./i);

    const text = container.textContent ?? "";
    expect(text).toContain("Self-host");
    expect(text).toContain("Hosted");
    expect(text).toContain("Custom");
  });

  it("makes the MIT licence and free price prominent", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <PricingPage />
        </MemoryRouter>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("MIT");
    expect(text).toContain("Free");
  });

  it("links the required services (Anthropic, Supabase) externally", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <PricingPage />
        </MemoryRouter>,
      );
    });

    const externalLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[target="_blank"]',
      ),
    );
    const labels = externalLinks.map((a) => a.textContent ?? "");
    expect(labels.some((l) => /Anthropic/i.test(l))).toBe(true);
    expect(labels.some((l) => /Supabase/i.test(l))).toBe(true);
  });
});
