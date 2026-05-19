import { describe, it, expect } from "vitest";

import {
  buildSceneDigest,
  computeViewportBounds,
  estimateTextWidth,
  lintWhiteboardPlacement,
  measureTextWidth,
} from "./whiteboardScene";

describe("whiteboardScene", () => {
  it("estimates text width from character count", () => {
    const w = estimateTextWidth("Hello world", 20);
    expect(w).toBeGreaterThan(80);
    expect(w).toBeLessThan(300);
  });

  it("allocates extra width for emoji in titles", () => {
    const plain = measureTextWidth("CLASSIC MEATLOAF", 28);
    const withEmoji = measureTextWidth("🍖 CLASSIC MEATLOAF", 28);
    expect(withEmoji).toBeGreaterThan(plain);
  });

  it("computes viewport from scroll and zoom", () => {
    const vp = computeViewportBounds({
      scrollX: -100,
      scrollY: -50,
      zoom: { value: 1 },
    });
    expect(vp.minX).toBe(100);
    expect(vp.minY).toBe(50);
    expect(vp.maxX).toBeGreaterThan(vp.minX);
  });

  it("builds a compact scene digest", () => {
    const digest = buildSceneDigest([
      {
        id: "a1",
        type: "text",
        x: 10,
        y: 20,
        width: 100,
        height: 24,
        text: "Title",
        strokeColor: "#1e1e1e",
      },
    ]);
    expect(digest).toHaveLength(1);
    expect(digest[0]?.text).toBe("Title");
  });

  it("warns when text box is narrower than content", () => {
    const vp = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
    const warnings = lintWhiteboardPlacement(
      { type: "text", x: 0, y: 0, width: 40, height: 24, fontSize: 20 },
      vp,
      "A very long title that will not fit",
    );
    expect(warnings.some((w) => w.includes("clipped"))).toBe(true);
  });
});
