import { describe, it, expect } from "vitest";

import {
  formatWorkspaceContextForPrompt,
  type WorkspaceContext,
} from "./workspaceContext.js";

const base: WorkspaceContext = {
  activeTab: "whiteboard",
  vision: "off",
  uiTheme: "light",
  whiteboard: {
    backgroundColor: "#f8f6f1",
    recommendedStrokeColor: "#1e1e1e",
    elementCount: 3,
  },
};

describe("formatWorkspaceContextForPrompt", () => {
  it("includes tab, vision-off note, and whiteboard colors", () => {
    const text = formatWorkspaceContextForPrompt(base);
    expect(text).toContain("<workspace_context>");
    expect(text).toContain("Active tab: whiteboard");
    expect(text).toContain("Vision for this turn: off");
    expect(text).toContain("do not receive a screenshot");
    expect(text).toContain("#f8f6f1");
    expect(text).toContain("#1e1e1e");
    expect(text).toContain("warm off-white");
  });

  it("includes optional map, documents, and web sections", () => {
    const text = formatWorkspaceContextForPrompt({
      ...base,
      activeTab: "map",
      map: {
        center: [47.6, -122.3],
        zoom: 10,
        layer: "satellite",
        pinCount: 2,
        shapeCount: 1,
      },
      documents: {
        activeDocumentId: "doc-1",
        activeDocumentName: "Ethics",
        activePage: 4,
        pageCount: 120,
        loadedDocumentNames: ["Ethics", "Notes"],
      },
      web: { url: "https://example.com/article" },
    });
    expect(text).toContain("layer satellite");
    expect(text).toContain('"Ethics" page 4 of 120');
    expect(text).toContain("https://example.com/article");
  });

  it("includes diagrams section when present", () => {
    const text = formatWorkspaceContextForPrompt({
      ...base,
      activeTab: "diagrams",
      diagrams: {
        cellCount: 4,
        labelDigest: ["Auth", "API"],
        hasContent: true,
        vertexCount: 2,
        edgeCount: 1,
        vertices: [{ id: "2", label: "Auth" }],
        edges: [{ id: "4", from: "2", to: "3", label: "calls" }],
      },
    });
    expect(text).toContain("Diagrams:");
    expect(text).toContain("has user content: yes");
    expect(text).toContain('"Auth"');
    expect(text).toContain("Vertices:");
    expect(text).toContain("2 → 3");
  });
});
