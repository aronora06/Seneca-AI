import { describe, it, expect, beforeEach } from "vitest";

import { DEFAULT_MAP_STATE, DEFAULT_WEB_STATE } from "@seneca/shared";

import { buildWorkspaceContext } from "./workspaceContext";
import { useSenecaStore } from "../store/seneca";

describe("buildWorkspaceContext", () => {
  beforeEach(() => {
    useSenecaStore.setState({
      activeTab: "map",
      mapState: {
        ...DEFAULT_MAP_STATE,
        center: [47.6, -122.3],
        zoom: 8,
        pins: [{ id: "p1", lat: 47.6, lng: -122.3, label: "Seattle" }],
        shapes: [],
      },
      documentsState: {
        items: [
          {
            id: "d1",
            name: "Ethics",
            filename: "ethics.pdf",
            size: 1000,
            pageCount: 10,
            currentPage: 2,
            uploadedAt: new Date().toISOString(),
            textStatus: "extracted",
          },
        ],
        activeId: "d1",
      },
      webState: { ...DEFAULT_WEB_STATE, url: "https://example.com" },
      whiteboard: { elements: [] },
    });
  });

  it("includes map, documents, and web from store slices", () => {
    const ctx = buildWorkspaceContext();
    expect(ctx.activeTab).toBe("map");
    expect(ctx.map?.center).toEqual([47.6, -122.3]);
    expect(ctx.map?.pins?.[0]?.label).toBe("Seattle");
    expect(ctx.documents?.activeDocumentName).toBe("Ethics");
    expect(ctx.documents?.documents?.[0]?.textStatus).toBe("extracted");
    expect(ctx.web?.url).toBe("https://example.com");
    expect(ctx.voice?.mode).toBeDefined();
  });
});
