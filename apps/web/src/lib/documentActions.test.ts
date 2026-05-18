import { describe, it, expect, vi, beforeEach } from "vitest";

const docApi = {
  goToPage: vi.fn(),
};
vi.mock("./documentBridge", () => ({
  getDocumentApi: () => docApi,
}));

import {
  applyDocumentGoToPage,
  coerceGoToPageInput,
} from "./documentActions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("coerceGoToPageInput", () => {
  it("rejects non-object input", () => {
    expect(() => coerceGoToPageInput(null)).toThrow();
    expect(() => coerceGoToPageInput("garbage")).toThrow();
  });

  it("rejects non-finite page", () => {
    expect(() => coerceGoToPageInput({ page: Number.NaN })).toThrow();
    expect(() => coerceGoToPageInput({ page: "abc" })).toThrow();
  });

  it("clamps low page numbers up to 1", () => {
    expect(coerceGoToPageInput({ page: 0 }).page).toBe(1);
    expect(coerceGoToPageInput({ page: -7 }).page).toBe(1);
  });

  it("floors decimals", () => {
    expect(coerceGoToPageInput({ page: 4.9 }).page).toBe(4);
  });

  it("passes through document_id when set, trimmed", () => {
    expect(
      coerceGoToPageInput({ page: 2, document_id: "  abc  " }).document_id,
    ).toBe("abc");
  });

  it("omits empty document_id", () => {
    expect(
      coerceGoToPageInput({ page: 2, document_id: "" }).document_id,
    ).toBeUndefined();
    expect(
      coerceGoToPageInput({ page: 2, document_id: "   " }).document_id,
    ).toBeUndefined();
  });
});

describe("applyDocumentGoToPage", () => {
  it("forwards page and optional document_id to the bridge", () => {
    applyDocumentGoToPage({ page: 12 });
    expect(docApi.goToPage).toHaveBeenLastCalledWith(12, undefined);

    applyDocumentGoToPage({ page: 5, document_id: "doc-99" });
    expect(docApi.goToPage).toHaveBeenLastCalledWith(5, "doc-99");
  });
});
