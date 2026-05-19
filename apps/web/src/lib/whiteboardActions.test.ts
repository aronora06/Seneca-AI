import { describe, it, expect, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (skeletons: unknown[]) =>
    skeletons.map((s, idx) => ({
      ...(s as Record<string, unknown>),
      id: `mock-${idx}`,
      version: 1,
      width: 120,
      height: 24,
    })),
}));

import { applyWhiteboardAdd, applyWhiteboardClear } from "./whiteboardActions";

type MockApi = {
  getSceneElements: ReturnType<typeof vi.fn>;
  getAppState: ReturnType<typeof vi.fn>;
  updateScene: ReturnType<typeof vi.fn>;
};

function makeApi(bg = "#f8f6f1"): MockApi {
  return {
    getSceneElements: vi.fn(() => []),
    getAppState: vi.fn(() => ({
      viewBackgroundColor: bg,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    })),
    updateScene: vi.fn(),
  };
}

describe("applyWhiteboardAdd input coercion", () => {
  it("rejects non-object input", async () => {
    const api = makeApi();
    await expect(
      applyWhiteboardAdd(api as never, "garbage" as never),
    ).rejects.toThrow();
    await expect(
      applyWhiteboardAdd(api as never, null as never),
    ).rejects.toThrow();
  });

  it("rejects unknown element types", async () => {
    const api = makeApi();
    await expect(
      applyWhiteboardAdd(api as never, {
        type: "blob",
        x: 0,
        y: 0,
      } as never),
    ).rejects.toThrow(/Unsupported element/);
  });

  it("rejects non-finite coordinates", async () => {
    const api = makeApi();
    await expect(
      applyWhiteboardAdd(api as never, {
        type: "text",
        x: "NaN",
        y: 0,
        text: "hi",
      } as never),
    ).rejects.toThrow(/coordinates must be finite/);
  });

  it("rejects empty-text text element", async () => {
    const api = makeApi();
    await expect(
      applyWhiteboardAdd(api as never, {
        type: "text",
        x: 100,
        y: 100,
        text: "  ",
      } as never),
    ).rejects.toThrow(/non-empty/);
  });

  it("accepts a valid text element and returns placement", async () => {
    const api = makeApi();
    const result = await applyWhiteboardAdd(api as never, {
      type: "text",
      x: 100,
      y: 100,
      text: "hello",
    } as never);
    expect(api.updateScene).toHaveBeenCalledOnce();
    expect(result.elementId).toBe("mock-0");
    expect(result.text).toBe("hello");
  });

  it("accepts a valid rectangle with default dimensions", async () => {
    const api = makeApi();
    await applyWhiteboardAdd(api as never, {
      type: "rectangle",
      x: 100,
      y: 100,
    } as never);
    expect(api.updateScene).toHaveBeenCalledOnce();
  });

  it("accepts an arrow with explicit points", async () => {
    const api = makeApi();
    await applyWhiteboardAdd(api as never, {
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

  it("returns applied stroke color in placement result", async () => {
    const api = makeApi("#f8f6f1");
    const result = await applyWhiteboardAdd(api as never, {
      type: "text",
      x: 100,
      y: 100,
      text: "visible",
      strokeColor: "#ffffff",
    } as never);
    expect(result.appliedStrokeColor).toBe("#1e1e1e");
  });

  it("freedraw is downgraded to a line (intentional)", async () => {
    const api = makeApi();
    await applyWhiteboardAdd(api as never, {
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
