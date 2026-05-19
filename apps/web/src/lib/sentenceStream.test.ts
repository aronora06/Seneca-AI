import { describe, expect, it } from "vitest";

import { createStreamingChunker, extractChunks } from "./sentenceStream";

describe("extractChunks", () => {
  it("returns nothing for an empty buffer", () => {
    expect(extractChunks("")).toEqual({ chunks: [], remainder: "" });
  });

  it("does not split a single incomplete sentence", () => {
    expect(extractChunks("Hello there")).toEqual({
      chunks: [],
      remainder: "Hello there",
    });
  });

  it("splits on '. '", () => {
    expect(extractChunks("Hello world. This is a test.")).toEqual({
      chunks: ["Hello world."],
      remainder: "This is a test.",
    });
  });

  it("splits on '! ' and '? '", () => {
    const out = extractChunks("Really?! Yes. No way!");
    expect(out.chunks).toEqual(["Really?!", "Yes."]);
    expect(out.remainder).toBe("No way!");
  });

  it("flushes when the final terminator is followed by EOF whitespace", () => {
    expect(extractChunks("Hello world.\n")).toEqual({
      chunks: ["Hello world."],
      remainder: "",
    });
  });

  it("splits on a paragraph break", () => {
    const out = extractChunks("First idea\n\nSecond idea");
    expect(out.chunks).toEqual(["First idea"]);
    expect(out.remainder).toBe("Second idea");
  });

  it("handles closing quotes after the terminator", () => {
    const out = extractChunks(`She said "no." Then she left.`);
    expect(out.chunks).toEqual([`She said "no."`]);
    expect(out.remainder).toBe("Then she left.");
  });

  it("force-flushes at a whitespace when buffer exceeds the soft cap", () => {
    const long = "word ".repeat(80).trim();
    const out = extractChunks(long, { maxChunkChars: 50 });
    expect(out.chunks.length).toBeGreaterThan(0);
    expect(out.chunks.every((c) => c.length <= 60)).toBe(true);
    expect(out.remainder.length).toBeLessThanOrEqual(50);
  });

  it("does not produce empty chunks", () => {
    const out = extractChunks("...   ...   ");
    expect(out.chunks.every((c) => c.length > 0)).toBe(true);
  });
});

describe("createStreamingChunker", () => {
  it("emits chunks across multiple deltas", () => {
    const chunker = createStreamingChunker();
    expect(chunker.push("Hello ")).toEqual([]);
    expect(chunker.push("world.")).toEqual([]);
    // No trailing whitespace yet — boundary not closed.
    expect(chunker.push(" Next ")).toEqual(["Hello world."]);
    expect(chunker.push("sentence.")).toEqual([]);
    expect(chunker.flush()).toEqual(["Next sentence."]);
  });

  it("handles paragraph breaks across deltas", () => {
    const chunker = createStreamingChunker();
    chunker.push("Opening line");
    const out = chunker.push("\n\nNew paragraph");
    expect(out).toEqual(["Opening line"]);
    expect(chunker.flush()).toEqual(["New paragraph"]);
  });

  it("reset discards the buffer without flushing", () => {
    const chunker = createStreamingChunker();
    chunker.push("Mid-sentence and then");
    chunker.reset();
    expect(chunker.flush()).toEqual([]);
  });

  it("flush returns nothing when buffer is empty / whitespace", () => {
    const chunker = createStreamingChunker();
    expect(chunker.flush()).toEqual([]);
    chunker.push("   ");
    expect(chunker.flush()).toEqual([]);
  });
});
