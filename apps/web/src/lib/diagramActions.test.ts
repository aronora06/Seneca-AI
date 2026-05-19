import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_DIAGRAM_XML } from "@seneca/shared";

import {
  applyDiagramClear,
  applyDiagramLoad,
  applyDiagramMerge,
  coerceDiagramLoadInput,
  coerceDiagramMergeInput,
} from "./diagramActions";
import { setDiagramBridge, type DiagramBridgeApi } from "./diagramBridge";
import { useSenecaStore } from "../store/seneca";

const LIVE_XML = EMPTY_DIAGRAM_XML.replace(
  "</root>",
  '<mxCell id="2" value="Live" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell></root>',
);

const getLiveXml = vi.fn(() => LIVE_XML);

const mockBridge: DiagramBridgeApi = {
  isReady: () => true,
  getLiveXml,
  loadXml: vi.fn().mockResolvedValue(undefined),
  loadMermaid: vi.fn().mockResolvedValue(undefined),
  mergeXml: vi.fn().mockResolvedValue({ merged: true }),
  clear: vi.fn().mockResolvedValue(undefined),
  layout: vi.fn().mockResolvedValue(undefined),
  exportPng: vi.fn().mockResolvedValue(null),
};

beforeEach(() => {
  vi.clearAllMocks();
  setDiagramBridge(mockBridge);
  useSenecaStore.setState({
    diagrams: { xml: EMPTY_DIAGRAM_XML },
  });
});

describe("coerceDiagramLoadInput", () => {
  it("accepts mermaid format", () => {
    expect(
      coerceDiagramLoadInput({ format: "mermaid", data: "flowchart TD\n  A-->B" }),
    ).toEqual({ format: "mermaid", data: "flowchart TD\n  A-->B" });
  });

  it("rejects missing data", () => {
    expect(() => coerceDiagramLoadInput({ format: "xml", data: "" })).toThrow(
      /data/,
    );
  });
});

describe("coerceDiagramMergeInput", () => {
  it("requires xml", () => {
    expect(() => coerceDiagramMergeInput({})).toThrow(/xml/);
  });
});

describe("applyDiagramLoad", () => {
  it("calls loadXml for xml format", async () => {
    const xml = EMPTY_DIAGRAM_XML.replace(
      "</root>",
      '<mxCell id="2" value="Hi" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell></root>',
    );
    await applyDiagramLoad({ format: "xml", data: xml });
    expect(mockBridge.loadXml).toHaveBeenCalledWith(xml);
  });

  it("calls loadMermaid for mermaid format", async () => {
    await applyDiagramLoad({ format: "mermaid", data: "flowchart TD\n  A-->B" });
    expect(mockBridge.loadMermaid).toHaveBeenCalled();
  });
});

describe("applyDiagramClear", () => {
  it("clears via bridge", async () => {
    const out = await applyDiagramClear();
    expect(mockBridge.clear).toHaveBeenCalled();
    expect(out.cleared).toBe(true);
  });
});

describe("applyDiagramMerge live xml", () => {
  it("uses bridge live xml for tool_result diff", async () => {
    const fragment = EMPTY_DIAGRAM_XML.replace(
      "</root>",
      '<mxCell id="3" value="Added" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell></root>',
    );
    const afterXml = LIVE_XML.replace(
      "</root>",
      '<mxCell id="3" value="Added" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell></root>',
    );
    getLiveXml.mockReturnValueOnce(LIVE_XML).mockReturnValueOnce(afterXml);
    const out = await applyDiagramMerge({ xml: fragment });
    expect(out.merged).toBe(true);
    expect(out.diff?.addedVertices.length).toBeGreaterThan(0);
  });
});
