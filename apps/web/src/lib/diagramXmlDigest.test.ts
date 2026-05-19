import { describe, expect, it } from "vitest";

import { EMPTY_DIAGRAM_XML } from "@seneca/shared";

import {
  diagramXmlDigest,
  hasDiagramStructuralCells,
  validateDiagramXml,
} from "./diagramXmlDigest";

describe("diagramXmlDigest", () => {
  it("reports empty for the default template", () => {
    const d = diagramXmlDigest(EMPTY_DIAGRAM_XML);
    expect(d.hasContent).toBe(false);
    expect(d.cellCount).toBe(0);
    expect(d.labelDigest).toEqual([]);
  });

  it("counts vertices and extracts labels", () => {
    const xml = `<mxGraphModel><root>
      <mxCell id="0"/>
      <mxCell id="1" parent="0"/>
      <mxCell id="2" value="Start" vertex="1" parent="1">
        <mxGeometry x="10" y="10" width="80" height="40" as="geometry"/>
      </mxCell>
    </root></mxGraphModel>`;
    const d = diagramXmlDigest(xml);
    expect(d.hasContent).toBe(true);
    expect(d.labelDigest).toContain("Start");
    expect(d.cellCount).toBeGreaterThan(0);
  });
});

describe("validateDiagramXml", () => {
  it("requires structural cells", () => {
    expect(validateDiagramXml("<mxGraphModel><root></root></mxGraphModel>")).toMatch(
      /id="0"/,
    );
    expect(hasDiagramStructuralCells(EMPTY_DIAGRAM_XML)).toBe(true);
  });
});
