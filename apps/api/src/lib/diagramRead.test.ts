import { describe, expect, it } from "vitest";

import { EMPTY_DIAGRAM_XML } from "@seneca/shared";

import { resolveDiagramRead } from "./diagramRead.js";

const SAMPLE = EMPTY_DIAGRAM_XML.replace(
  "</root>",
  `<mxCell id="2" value="A" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>
   <mxCell id="3" value="B" vertex="1" parent="1"><mxGeometry x="120" y="0" width="80" height="40" as="geometry"/></mxCell>
   <mxCell id="4" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root>`,
);

describe("resolveDiagramRead", () => {
  it("returns structured JSON with vertices and mermaid", () => {
    const raw = resolveDiagramRead(SAMPLE, { includeMermaid: true });
    const parsed = JSON.parse(raw) as {
      empty: boolean;
      vertices: { id: string }[];
      mermaid?: string;
    };
    expect(parsed.empty).toBe(false);
    expect(parsed.vertices).toHaveLength(2);
    expect(parsed.mermaid).toMatch(/flowchart/);
  });

  it("omits mermaid when includeMermaid is false", () => {
    const raw = resolveDiagramRead(SAMPLE, { includeMermaid: false });
    const parsed = JSON.parse(raw) as { mermaid?: string };
    expect(parsed.mermaid).toBeUndefined();
  });
});
