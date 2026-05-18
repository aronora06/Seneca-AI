/**
 * Phase E — tests for the SPA heuristic + cached browser life-cycle.
 *
 * The real Playwright integration is covered by smoke tests against a
 * deployed environment; these tests live entirely in-process. We
 * cover:
 *   - SPA shell detection on real HTML fixtures
 *   - The lazy-loader's "missing package" path returns false instead
 *     of throwing
 *   - The HeadlessRenderError class round-trips its httpStatus
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  __resetHeadlessForTests,
  HeadlessRenderError,
  isHeadlessAvailable,
  looksLikeSpaShell,
} from "./headlessRender.js";

afterEach(() => {
  __resetHeadlessForTests();
});

describe("looksLikeSpaShell", () => {
  it("flags a Next.js-style empty shell", () => {
    expect(
      looksLikeSpaShell({
        rawHtml:
          '<html><head><script src="/_next/static/chunks/x.js"></script><script src="/_next/static/chunks/y.js"></script></head><body><div id="__next"></div></body></html>',
        visibleText: "",
      }),
    ).toBe(true);
  });

  it("flags a React-hydrated shell with very little visible text", () => {
    expect(
      looksLikeSpaShell({
        rawHtml:
          '<html><body><div data-reactroot></div><script>1</script><script>2</script><script>3</script></body></html>',
        visibleText: "Loading…",
      }),
    ).toBe(true);
  });

  it("does NOT flag a server-rendered article page", () => {
    const article = "Lorem ipsum ".repeat(200); // ~2400 chars
    expect(
      looksLikeSpaShell({
        rawHtml:
          "<html><body><article>" +
          article +
          "</article><script src='analytics.js'></script></body></html>",
        visibleText: article,
      }),
    ).toBe(false);
  });

  it("does NOT flag a static site even with several scripts", () => {
    const body = "Wikipedia content paragraph. ".repeat(50);
    expect(
      looksLikeSpaShell({
        rawHtml:
          "<html><body>" +
          body +
          "<script>a</script><script>b</script></body></html>",
        visibleText: body,
      }),
    ).toBe(false);
  });

  it("flags pages with a very high script-to-text ratio", () => {
    const tinyBody = "Hello"; // 5 chars
    const manyScripts = "<script></script>".repeat(20);
    expect(
      looksLikeSpaShell({
        rawHtml: `<html><body>${manyScripts}<p>${tinyBody}</p></body></html>`,
        visibleText: tinyBody,
      }),
    ).toBe(true);
  });
});

describe("isHeadlessAvailable", () => {
  it("returns false when playwright-core can't be loaded", async () => {
    // The test runner doesn't have playwright-core installed; the
    // dynamic import should fail and the cached result should be false.
    const available = await isHeadlessAvailable();
    expect(available).toBe(false);
    // Subsequent calls reuse the cached promise.
    expect(await isHeadlessAvailable()).toBe(false);
  });
});

describe("HeadlessRenderError", () => {
  it("preserves code and httpStatus", () => {
    const err = new HeadlessRenderError(
      "navigation_timeout",
      "took too long",
      504,
    );
    expect(err.code).toBe("navigation_timeout");
    expect(err.httpStatus).toBe(504);
    expect(err.message).toBe("took too long");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("HeadlessRenderError");
  });
});
