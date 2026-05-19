import { describe, it, expect } from "vitest";

import {
  ensureReadableStroke,
  recommendedStrokeForBackground,
} from "./whiteboardTheme";

describe("whiteboardTheme contrast", () => {
  it("recommends dark strokes on light boards", () => {
    expect(recommendedStrokeForBackground("#f8f6f1")).toBe("#1e1e1e");
  });

  it("recommends light strokes on dark boards", () => {
    expect(recommendedStrokeForBackground("#0e0a06")).toBe("#e8e8e8");
  });

  it("replaces low-contrast strokes", () => {
    expect(ensureReadableStroke("#f0f0f0", "#f8f6f1")).toBe("#1e1e1e");
    expect(ensureReadableStroke("#111111", "#0e0a06")).toBe("#e8e8e8");
  });

  it("keeps high-contrast custom strokes", () => {
    expect(ensureReadableStroke("#c92a2a", "#f8f6f1")).toBe("#c92a2a");
  });
});
