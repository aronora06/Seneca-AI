import { describe, it, expect } from "vitest";

import type { ToolCallRecord } from "@seneca/shared";

import { presentTool } from "./toolSummary";

function rec(name: string, input: Record<string, unknown>): ToolCallRecord {
  return { id: "test", name, input };
}

describe("presentTool labels", () => {
  it("translates known tool names to friendly labels", () => {
    expect(presentTool(rec("whiteboard_add_element", {})).label).toBe("draw");
    expect(presentTool(rec("whiteboard_clear", {})).label).toBe("clear board");
    expect(presentTool(rec("map_fly_to", {})).label).toBe("fly to");
    expect(presentTool(rec("web_search", {})).label).toBe("web search");
    expect(presentTool(rec("document_list", {})).label).toBe("list docs");
    expect(presentTool(rec("document_search", {})).label).toBe("search docs");
    expect(presentTool(rec("document_read_page", {})).label).toBe("read page");
  });

  it("falls back to the raw name for unknown tools", () => {
    expect(presentTool(rec("future_tool", {})).label).toBe("future_tool");
  });
});

describe("presentTool summaries", () => {
  it("whiteboard_clear is a fixed string", () => {
    expect(presentTool(rec("whiteboard_clear", {})).summary).toBe(
      "wiped the whiteboard",
    );
  });

  it("whiteboard text element shows the text and coordinates", () => {
    const s = presentTool(
      rec("whiteboard_add_element", {
        type: "text",
        x: 100,
        y: 50,
        text: "Premise 1",
      }),
    ).summary;
    expect(s).toContain("Premise 1");
    expect(s).toContain("(100, 50)");
  });

  it("whiteboard rectangle shows dimensions", () => {
    const s = presentTool(
      rec("whiteboard_add_element", {
        type: "rectangle",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
      }),
    ).summary;
    expect(s).toContain("rectangle 200×100");
  });

  it("map_fly_to includes lat/lng and optional zoom/label", () => {
    const s = presentTool(
      rec("map_fly_to", { lat: 41.9, lng: 12.5, zoom: 10, label: "Rome" }),
    ).summary;
    expect(s).toContain("(41.90, 12.50)");
    expect(s).toContain("z10");
    expect(s).toContain("Rome");
  });

  it("map_drop_pin includes the label and coordinates", () => {
    const s = presentTool(
      rec("map_drop_pin", { lat: 0, lng: 0, label: "Origin" }),
    ).summary;
    expect(s).toContain("Origin");
  });

  it("web_navigate pretty-prints the URL", () => {
    const s = presentTool(
      rec("web_navigate", { url: "https://www.example.com/foo/bar" }),
    ).summary;
    expect(s).toBe("example.com/foo/bar");
  });

  it("web_search shows the query and capped result count", () => {
    expect(
      presentTool(rec("web_search", { query: "Spinoza", max_results: 3 }))
        .summary,
    ).toContain("Spinoza");
  });

  it("document_go_to_page shows the page number", () => {
    expect(
      presentTool(rec("document_go_to_page", { page: 12 })).summary,
    ).toContain("page 12");
  });

  it("document_read_page shows the page number", () => {
    expect(
      presentTool(rec("document_read_page", { page: 7 })).summary,
    ).toContain("page 7");
  });

  it("document_list summary is descriptive", () => {
    expect(presentTool(rec("document_list", {})).summary).toBe(
      "loaded documents",
    );
  });

  it("document_search shows the query and top_k", () => {
    const s = presentTool(
      rec("document_search", { query: "stoicism", top_k: 3 }),
    ).summary;
    expect(s).toContain("stoicism");
    expect(s).toContain("top 3");
  });

  it("document_search defaults top_k to 5 in the chip", () => {
    expect(
      presentTool(rec("document_search", { query: "x" })).summary,
    ).toContain("top 5");
  });

  it("document_search shows doc scope when document_id is set", () => {
    const s = presentTool(
      rec("document_search", { query: "x", document_id: "doc-abc12345" }),
    ).summary;
    expect(s).toContain("in doc");
  });
});
