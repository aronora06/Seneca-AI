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

import { HomePage } from "./HomePage";

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

describe("HomePage", () => {
  it("renders the headline and primary CTA pointing at /login", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>,
      );
    });

    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toMatch(
      /A voice you talk with, on a canvas you both use\./i,
    );

    const loginLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href="/login"]'),
    );
    expect(loginLinks.length).toBeGreaterThan(0);
    const heroCta = loginLinks[0];
    expect(heroCta?.textContent).toMatch(/Get started/i);
  });

  it("links to the about page from the hero", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>,
      );
    });

    const aboutLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href="/about"]'),
    );
    expect(aboutLinks.length).toBeGreaterThan(0);
    expect(aboutLinks[0].textContent).toMatch(/How it works/i);
  });

  it("renders the four core feature pillars", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("Talk while you work");
    expect(text).toContain("A canvas you both use");
    expect(text).toContain("Grounded in your materials");
    expect(text).toContain("Vision when you want it");
  });

  it("teases the privacy notice", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>,
      );
    });

    const privacyLinks = container.querySelectorAll('a[href="/privacy"]');
    expect(privacyLinks.length).toBeGreaterThan(0);
  });
});
