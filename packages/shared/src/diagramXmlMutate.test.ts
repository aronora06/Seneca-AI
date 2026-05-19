import { describe, expect, it } from "vitest";

import { removeCells, setCellLabel } from "./diagramXmlMutate.js";

const XML = `<mxGraphModel><root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
  <mxCell id="2" value="Old" vertex="1" parent="1"/>
</root></mxGraphModel>`;

describe("setCellLabel", () => {
  it("updates value attribute", () => {
    const next = setCellLabel(XML, "2", "New");
    expect(next).toContain('value="New"');
    expect(next).not.toContain("Old");
  });

  it("returns null for missing cell", () => {
    expect(setCellLabel(XML, "99", "x")).toBeNull();
  });

  it("refuses structural cells", () => {
    expect(setCellLabel(XML, "0", "x")).toBeNull();
  });
});

describe("removeCells", () => {
  it("removes cells by id", () => {
    const next = removeCells(XML, ["2"]);
    expect(next).not.toMatch(/id="2"/);
    expect(next).toMatch(/id="0"/);
  });

  it("never removes structural cells", () => {
    const next = removeCells(XML, ["0", "1", "2"]);
    expect(next).toMatch(/id="0"/);
    expect(next).toMatch(/id="1"/);
  });
});
