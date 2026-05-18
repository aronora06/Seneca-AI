import { describe, it, expect } from "vitest";

import {
  DEFAULT_DOCUMENTS_STATE,
  DEFAULT_MAP_STATE,
  DEFAULT_WEB_STATE,
} from "./types";

describe("default state constants", () => {
  it("DEFAULT_MAP_STATE has a centred neutral view", () => {
    expect(DEFAULT_MAP_STATE.center).toEqual([20, 0]);
    expect(DEFAULT_MAP_STATE.zoom).toBe(2);
    expect(DEFAULT_MAP_STATE.layer).toBe("standard");
    expect(DEFAULT_MAP_STATE.pins).toEqual([]);
    expect(DEFAULT_MAP_STATE.shapes).toEqual([]);
  });

  it("DEFAULT_WEB_STATE is empty history", () => {
    expect(DEFAULT_WEB_STATE.url).toBeNull();
    expect(DEFAULT_WEB_STATE.history).toEqual([]);
    expect(DEFAULT_WEB_STATE.historyIndex).toBe(-1);
  });

  it("DEFAULT_DOCUMENTS_STATE has no items and no active id", () => {
    expect(DEFAULT_DOCUMENTS_STATE.items).toEqual([]);
    expect(DEFAULT_DOCUMENTS_STATE.activeId).toBeNull();
  });
});
