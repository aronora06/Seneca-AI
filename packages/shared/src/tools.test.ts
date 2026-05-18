import { describe, it, expect } from "vitest";

import {
  ALL_TOOLS,
  DOCUMENT_CREATE,
  DOCUMENT_GO_TO_PAGE,
  DOCUMENT_LIST,
  DOCUMENT_READ_PAGE,
  DOCUMENT_SEARCH,
  MAP_DRAW_SHAPE,
  MAP_DROP_PIN,
  MAP_FLY_TO,
  MAP_SET_LAYER,
  WEB_NAVIGATE,
  WEB_READ_PAGE,
  WEB_SEARCH,
  WHITEBOARD_ADD_ELEMENT,
  WHITEBOARD_CLEAR,
  type ToolName,
} from "./tools";

describe("ALL_TOOLS", () => {
  it("contains every named tool exactly once", () => {
    const expected = new Set<ToolName>([
      "whiteboard_add_element",
      "whiteboard_clear",
      "map_fly_to",
      "map_drop_pin",
      "map_draw_shape",
      "map_set_layer",
      "web_navigate",
      "web_search",
      "web_read_page",
      "document_go_to_page",
      "document_read_page",
      "document_list",
      "document_search",
      "document_create",
    ]);

    const actual = new Set(ALL_TOOLS.map((t) => t.name));
    expect(actual).toEqual(expected);
    expect(ALL_TOOLS).toHaveLength(expected.size);
  });

  it("each tool name matches Anthropic's allowed regex", () => {
    const allowed = /^[a-zA-Z0-9_-]{1,128}$/;
    for (const tool of ALL_TOOLS) {
      expect(tool.name, `tool ${tool.name} violates Anthropic naming`).toMatch(
        allowed,
      );
    }
  });

  it("each tool has a non-empty description and an object schema", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.properties).toBeTypeOf("object");
    }
  });

  it("required fields are listed in properties", () => {
    for (const tool of ALL_TOOLS) {
      const required = tool.input_schema.required ?? [];
      const props = Object.keys(tool.input_schema.properties);
      for (const r of required) {
        expect(props, `${tool.name}.required[${r}] not in properties`).toContain(
          r,
        );
      }
    }
  });
});

describe("individual tool definitions", () => {
  it("WHITEBOARD_ADD_ELEMENT requires type/x/y", () => {
    expect(WHITEBOARD_ADD_ELEMENT.input_schema.required).toEqual([
      "type",
      "x",
      "y",
    ]);
  });

  it("WHITEBOARD_CLEAR takes no required input", () => {
    expect(WHITEBOARD_CLEAR.input_schema.required ?? []).toEqual([]);
  });

  it("MAP_FLY_TO requires lat/lng", () => {
    expect(MAP_FLY_TO.input_schema.required).toEqual(["lat", "lng"]);
  });

  it("MAP_DROP_PIN requires lat/lng/label", () => {
    expect(MAP_DROP_PIN.input_schema.required).toEqual(["lat", "lng", "label"]);
  });

  it("MAP_DRAW_SHAPE requires type/points", () => {
    expect(MAP_DRAW_SHAPE.input_schema.required).toEqual(["type", "points"]);
  });

  it("MAP_SET_LAYER requires layer", () => {
    expect(MAP_SET_LAYER.input_schema.required).toEqual(["layer"]);
  });

  it("WEB_NAVIGATE requires url", () => {
    expect(WEB_NAVIGATE.input_schema.required).toEqual(["url"]);
  });

  it("WEB_SEARCH requires query", () => {
    expect(WEB_SEARCH.input_schema.required).toEqual(["query"]);
  });

  it("WEB_READ_PAGE has no required field (defaults to current page)", () => {
    expect(WEB_READ_PAGE.input_schema.required ?? []).toEqual([]);
  });

  it("DOCUMENT_GO_TO_PAGE requires page", () => {
    expect(DOCUMENT_GO_TO_PAGE.input_schema.required).toEqual(["page"]);
  });

  it("DOCUMENT_READ_PAGE requires page", () => {
    expect(DOCUMENT_READ_PAGE.input_schema.required).toEqual(["page"]);
  });

  it("DOCUMENT_LIST takes no required input", () => {
    expect(DOCUMENT_LIST.input_schema.required ?? []).toEqual([]);
  });

  it("DOCUMENT_SEARCH requires query", () => {
    expect(DOCUMENT_SEARCH.input_schema.required).toEqual(["query"]);
  });

  it("DOCUMENT_CREATE requires title + content", () => {
    expect(DOCUMENT_CREATE.input_schema.required).toEqual(["title", "content"]);
  });
});
