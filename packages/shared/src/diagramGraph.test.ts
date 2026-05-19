import { describe, expect, it } from "vitest";

import { EMPTY_DIAGRAM_XML } from "./diagramEmpty.js";
import {
  diffDiagramGraph,
  digestDiagramGraph,
  graphToMermaid,
  lintDiagramGraph,
  parseDiagramGraph,
} from "./diagramGraph.js";

const FLOWCHART_XML = `<mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="2" value="Start" vertex="1" parent="1" style="rounded=1;">
    <mxGeometry x="10" y="10" width="80" height="40" as="geometry"/>
  </mxCell>
  <mxCell id="3" value="End" vertex="1" parent="1">
    <mxGeometry x="200" y="10" width="80" height="40" as="geometry"/>
  </mxCell>
  <mxCell id="4" edge="1" parent="1" source="2" target="3" value="go">
    <mxGeometry relative="1" as="geometry"/>
  </mxCell>
</root></mxGraphModel>`;

describe("parseDiagramGraph", () => {
  it("reports empty for default template", () => {
    const g = parseDiagramGraph(EMPTY_DIAGRAM_XML);
    expect(g.hasContent).toBe(false);
    expect(g.vertices).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it("parses vertices, edges, and bounds", () => {
    const g = parseDiagramGraph(FLOWCHART_XML);
    expect(g.vertices).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
    expect(g.vertices[0]!.label).toBe("Start");
    expect(g.edges[0]!.source).toBe("2");
    expect(g.bounds).toBeDefined();
    expect(g.bounds!.w).toBeGreaterThan(0);
  });
});

describe("digestDiagramGraph", () => {
  it("caps vertices and edges", () => {
    const g = parseDiagramGraph(FLOWCHART_XML);
    const d = digestDiagramGraph(g, { maxVertices: 1, maxEdges: 1 });
    expect(d.vertices).toHaveLength(1);
    expect(d.edges).toHaveLength(1);
    expect(d.labelDigest).toContain("Start");
  });
});

describe("diffDiagramGraph", () => {
  it("detects added vertices", () => {
    const before = EMPTY_DIAGRAM_XML;
    const after = FLOWCHART_XML;
    const diff = diffDiagramGraph(before, after);
    expect(diff.addedVertices).toContain("2");
    expect(diff.addedEdges).toContain("4");
  });
});

describe("lintDiagramGraph", () => {
  it("warns on duplicate labels", () => {
    const xml = FLOWCHART_XML.replace('value="End"', 'value="Start"');
    const g = parseDiagramGraph(xml);
    const w = lintDiagramGraph(g);
    expect(w.some((x) => /Duplicate/.test(x))).toBe(true);
  });

  it("warns on dangling edge endpoint", () => {
    const xml = FLOWCHART_XML.replace('target="3"', 'target="99"');
    const g = parseDiagramGraph(xml);
    const w = lintDiagramGraph(g);
    expect(w.some((x) => /missing target/.test(x))).toBe(true);
  });
});

describe("graphToMermaid", () => {
  it("emits flowchart for small graphs", () => {
    const g = parseDiagramGraph(FLOWCHART_XML);
    const m = graphToMermaid(g);
    expect(m).toMatch(/^flowchart TD/);
    expect(m).toContain("-->");
  });
});
