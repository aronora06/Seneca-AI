import { describe, expect, it } from "vitest";

import { meetsTextContrast } from "./contrast";
import { COLOR_PALETTES, resolvePaletteTokens } from "./palettes";

describe("color palettes", () => {
  it("every preset meets WCAG AA for primary text on surface", () => {
    for (const p of COLOR_PALETTES) {
      for (const mode of ["light", "dark"] as const) {
        const t = resolvePaletteTokens(p.id, mode, null);
        expect(
          meetsTextContrast(t.fg, t.surface),
          `${p.id} ${mode} fg on surface`,
        ).toBe(true);
      }
    }
  });

  it("merges overrides on top of a preset", () => {
    const t = resolvePaletteTokens("parchment", "light", { accent: "0 0 0" });
    expect(t.accent).toBe("0 0 0");
    expect(t.surface).toBe(resolvePaletteTokens("parchment", "light", null).surface);
  });
});
