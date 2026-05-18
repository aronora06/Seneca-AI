import { describe, it, expect, vi, beforeEach } from "vitest";

const webApi = {
  navigate: vi.fn(async () => undefined),
  showSearchResults: vi.fn(),
};
vi.mock("./webBridge", () => ({
  getWebApi: () => webApi,
}));

import {
  applyWebNavigate,
  coerceNavigateInput,
  coerceSearchInput,
} from "./webActions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("coerceNavigateInput", () => {
  it("accepts http/https", () => {
    expect(coerceNavigateInput({ url: "http://example.com" }).url).toBe(
      "http://example.com",
    );
    expect(
      coerceNavigateInput({ url: "https://example.com/foo" }).url,
    ).toBe("https://example.com/foo");
  });

  it("rejects empty / non-string url", () => {
    expect(() => coerceNavigateInput({ url: "" })).toThrow(/non-empty/);
    expect(() => coerceNavigateInput({ url: "   " })).toThrow(/non-empty/);
    expect(() => coerceNavigateInput({})).toThrow(/non-empty/);
  });

  it("rejects non-http schemes", () => {
    expect(() => coerceNavigateInput({ url: "ftp://x.example" })).toThrow(
      /http/i,
    );
    expect(() =>
      coerceNavigateInput({ url: "javascript:alert(1)" }),
    ).toThrow(/http/i);
  });
});

describe("coerceSearchInput", () => {
  it("requires a non-empty query", () => {
    expect(() => coerceSearchInput({ query: "" })).toThrow();
    expect(() => coerceSearchInput({ query: "   " })).toThrow();
    expect(() => coerceSearchInput({})).toThrow();
  });

  it("trims the query", () => {
    expect(coerceSearchInput({ query: "  hello  " }).query).toBe("hello");
  });

  it("clamps max_results to [1, 10]", () => {
    expect(coerceSearchInput({ query: "x", max_results: 50 }).max_results).toBe(
      10,
    );
    expect(coerceSearchInput({ query: "x", max_results: 0 }).max_results).toBe(
      1,
    );
    expect(coerceSearchInput({ query: "x", max_results: 5 }).max_results).toBe(
      5,
    );
  });

  it("omits max_results when not numeric", () => {
    const out = coerceSearchInput({ query: "x" });
    expect(out.max_results).toBeUndefined();
  });
});

describe("applyWebNavigate", () => {
  it("calls the bridge's navigate", async () => {
    await applyWebNavigate({ url: "https://example.com" });
    expect(webApi.navigate).toHaveBeenCalledWith("https://example.com");
  });
});
