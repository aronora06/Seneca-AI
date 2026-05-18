import { describe, it, expect, vi } from "vitest";

// Excalidraw's ESM build pulls in open-color/open-color.json via a bare
// JSON import, which Node's loader rejects without an import attribute.
// We mock just the function we use; the actions don't need the real
// Excalidraw scene model for coercion testing.
vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (skeletons: unknown[]) =>
    skeletons.map((s, idx) => ({
      ...(s as Record<string, unknown>),
      id: `mock-${idx}`,
      version: 1,
    })),
}));

import { applyWhiteboardAdd, applyWhiteboardClear } from "./whiteboardActions";

// Excalidraw's API surface is large; we mock just what the actions need.
type MockApi = {
  getSceneElements: ReturnType<typeof vi.fn>;
  updateScene: ReturnType<typeof vi.fn>;
};

function makeApi(): MockApi {
  return {
    getSceneElements: vi.fn(() => []),
    updateScene: vi.fn(),
  };
}

describe("applyWhiteboardAdd input coercion", () => {
  it("rejects non-object input", () => {
    const api = makeApi();
    expect(() =>
      applyWhiteboardAdd(api as never, "garbage" as never),
    ).toThrow();
    expect(() => applyWhiteboardAdd(api as never, null as never)).toThrow();
  });

  it("rejects unknown element types", () => {
    const api = makeApi();
    expect(() =>
      applyWhiteboardAdd(api as never, {
        type: "blob",
        x: 0,
        y: 0,
      } as never),
    ).toThrow(/Unsupported element/);
  });

  it("rejects non-finite coordinates", () => {
    const api = makeApi();
    expect(() =>
      applyWhiteboardAdd(api as never, {
        type: "text",
        x: "NaN",
        y: 0,
        text: "hi",
      } as never),
    ).toThrow(/coordinates must be finite/);
  });

  it("rejects empty-text text element", () => {
    const api = makeApi();
    expect(() =>
      applyWhiteboardAdd(api as never, {
        type: "text",
        x: 100,
        y: 100,
        text: "  ",
      } as never),
    ).toThrow(/non-empty/);
  });

  it("accepts a valid text element", () => {
    const api = makeApi();
    applyWhiteboardAdd(api as never, {
      type: "text",
      x: 100,
      y: 100,
      text: "hello",
    } as never);
    expect(api.updateScene).toHaveBeenCalledOnce();
  });

  it("accepts a valid rectangle with default dimensions", () => {
    const api = makeApi();
    applyWhiteboardAdd(api as never, {
      type: "rectangle",
      x: 100,
      y: 100,
    } as never);
    expect(api.updateScene).toHaveBeenCalledOnce();
  });

  it("accepts an arrow with explicit points", () => {
    const api = makeApi();
    applyWhiteboardAdd(api as never, {
      type: "arrow",
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [50, 50],
      ],
    } as never);
    expect(api.updateScene).toHaveBeenCalledOnce();
  });

  it("freedraw is downgraded to a line (intentional)", () => {
    const api = makeApi();
    applyWhiteboardAdd(api as never, {
      type: "freedraw",
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [10, 10],
      ],
    } as never);
    expect(api.updateScene).toHaveBeenCalledOnce();
  });
});

describe("applyWhiteboardClear", () => {
  it("calls updateScene with an empty elements array", () => {
    const api = makeApi();
    applyWhiteboardClear(api as never);
    expect(api.updateScene).toHaveBeenCalledWith({ elements: [] });
  });
});
