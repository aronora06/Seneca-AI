import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ToolCall } from "@seneca/shared";

// Excalidraw imports a bare JSON file which Node's ESM loader can't
// resolve under Vitest without import-attribute support. Stub the one
// function whiteboardActions touches.
vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: (skeletons: unknown[]) =>
    skeletons.map((s, idx) => ({
      ...(s as Record<string, unknown>),
      id: `mock-${idx}`,
      version: 1,
    })),
}));

// Mock all the bridges. We only care that the dispatcher routes correctly
// and pulses the right tab; the actual handlers are tested elsewhere.
const wbApi = {
  getSceneElements: vi.fn(() => []),
  updateScene: vi.fn(),
};
const mapApi = {
  flyTo: vi.fn(),
  addPin: vi.fn(),
  addShape: vi.fn(),
  setLayer: vi.fn(),
};
const webApi = {
  navigate: vi.fn(async () => undefined),
  showSearchResults: vi.fn(),
};
const docApi = {
  goToPage: vi.fn(),
};

vi.mock("./whiteboardBridge", () => ({
  getWhiteboardApi: () => wbApi,
}));
vi.mock("./mapBridge", () => ({
  getMapApi: () => mapApi,
}));
vi.mock("./webBridge", () => ({
  getWebApi: () => webApi,
}));
vi.mock("./documentBridge", () => ({
  getDocumentApi: () => docApi,
}));

// Mock the API client so web_search doesn't try a real fetch.
vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public body?: string,
    ) {
      super(message);
    }
  },
  apiJson: vi.fn(async () => ({ results: [] })),
}));

import { dispatchToolCall } from "./actionDispatcher";
import { useSenecaStore } from "../store/seneca";

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: `tool-${name}`, name, input };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to a known starting tab so we can verify pulse direction.
  useSenecaStore.getState().setActiveTab("whiteboard");
});

describe("dispatchToolCall routing", () => {
  it("routes whiteboard_add_element to the whiteboard bridge", async () => {
    const r = await dispatchToolCall(
      call("whiteboard_add_element", {
        type: "text",
        x: 100,
        y: 100,
        text: "hi",
      }),
    );
    expect(r.ok).toBe(true);
    expect(wbApi.updateScene).toHaveBeenCalled();
  });

  it("routes whiteboard_clear and wipes the scene", async () => {
    const r = await dispatchToolCall(call("whiteboard_clear"));
    expect(r.ok).toBe(true);
    expect(wbApi.updateScene).toHaveBeenCalledWith({ elements: [] });
  });

  it("routes map_fly_to and pulses the map tab", async () => {
    const r = await dispatchToolCall(call("map_fly_to", { lat: 1, lng: 2 }));
    expect(r.ok).toBe(true);
    expect(mapApi.flyTo).toHaveBeenCalled();
    expect(useSenecaStore.getState().activeTab).toBe("map");
  });

  it("routes map_drop_pin", async () => {
    const r = await dispatchToolCall(
      call("map_drop_pin", { lat: 1, lng: 2, label: "L" }),
    );
    expect(r.ok).toBe(true);
    expect(mapApi.addPin).toHaveBeenCalled();
  });

  it("routes web_navigate and pulses the web tab", async () => {
    const r = await dispatchToolCall(
      call("web_navigate", { url: "https://example.com" }),
    );
    expect(r.ok).toBe(true);
    expect(webApi.navigate).toHaveBeenCalledWith("https://example.com");
    expect(useSenecaStore.getState().activeTab).toBe("web");
  });

  it("web_read_page is server-fulfilled: dispatcher acks without touching the bridge", async () => {
    const r = await dispatchToolCall(
      call("web_read_page", { url: "https://example.com" }),
    );
    expect(r.ok).toBe(true);
    expect(webApi.navigate).not.toHaveBeenCalled();
  });

  it("document_go_to_page routes to the documents bridge", async () => {
    const r = await dispatchToolCall(
      call("document_go_to_page", { page: 5 }),
    );
    expect(r.ok).toBe(true);
    expect(docApi.goToPage).toHaveBeenCalledWith(5, undefined);
    expect(useSenecaStore.getState().activeTab).toBe("documents");
  });

  it("document_read_page is server-fulfilled and just pulses the tab", async () => {
    const r = await dispatchToolCall(call("document_read_page", { page: 5 }));
    expect(r.ok).toBe(true);
    expect(docApi.goToPage).not.toHaveBeenCalled();
    expect(useSenecaStore.getState().activeTab).toBe("documents");
  });

  it("document_list is server-fulfilled and just pulses the tab", async () => {
    const r = await dispatchToolCall(call("document_list"));
    expect(r.ok).toBe(true);
    expect(useSenecaStore.getState().activeTab).toBe("documents");
  });

  it("document_search is server-fulfilled and just pulses the tab", async () => {
    const r = await dispatchToolCall(
      call("document_search", { query: "x" }),
    );
    expect(r.ok).toBe(true);
    expect(useSenecaStore.getState().activeTab).toBe("documents");
  });

  it("returns ok=false for unknown tools", async () => {
    const r = await dispatchToolCall(call("future_tool"));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown tool/);
  });

  it("returns ok=false on coercion errors", async () => {
    const r = await dispatchToolCall(
      call("map_fly_to", { lat: "garbage", lng: 0 }),
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/finite/);
  });
});
