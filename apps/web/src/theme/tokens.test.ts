import { describe, expect, it } from "vitest";

import { hexToRgbTriple, rgbTripleToHex } from "./tokens";

describe("token colour helpers", () => {
  it("round-trips hex and RGB triples", () => {
    expect(rgbTripleToHex("212 154 71")).toBe("#d49a47");
    expect(hexToRgbTriple("#d49a47")).toBe("212 154 71");
  });

  it("rejects invalid hex", () => {
    expect(hexToRgbTriple("not-a-colour")).toBeNull();
  });
});
