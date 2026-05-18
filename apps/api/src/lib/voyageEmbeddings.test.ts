import { describe, it, expect } from "vitest";

import {
  cosineSimilarity,
  EMBEDDING_DIMS,
  _internals,
} from "./voyageEmbeddings.js";

describe("cosineSimilarity", () => {
  it("identical vectors score 1 (after [-1,1]→[0,1] normalisation)", () => {
    const v = [1, 0, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("orthogonal vectors score 0.5", () => {
    // cos = 0; (0 + 1) / 2 = 0.5
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.5, 5);
  });

  it("opposite vectors score 0", () => {
    // cos = -1; (-1 + 1) / 2 = 0
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(0, 5);
  });

  it("returns 0 on dimension mismatch", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it("returns 0 on empty input", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 when either side is the zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("scales correctly — direction is what matters, not magnitude", () => {
    expect(cosineSimilarity([1, 0], [10, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1, 5);
  });

  it("matches _internals export (no drift between named and re-exported)", () => {
    expect(_internals.cosineSimilarity).toBe(cosineSimilarity);
  });
});

describe("EMBEDDING_DIMS constant", () => {
  it("matches the vector(1024) column type documented in setup.md", () => {
    expect(EMBEDDING_DIMS).toBe(1024);
  });
});
