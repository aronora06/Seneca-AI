import { describe, it, expect } from "vitest";

import { ApiError, isTransientStatus } from "./api";

describe("isTransientStatus", () => {
  it("treats 0 (network) as transient", () => {
    expect(isTransientStatus(0)).toBe(true);
  });

  it("treats 408 / 425 / 429 as transient", () => {
    expect(isTransientStatus(408)).toBe(true);
    expect(isTransientStatus(425)).toBe(true);
    expect(isTransientStatus(429)).toBe(true);
  });

  it("treats every 5xx as transient", () => {
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(599)).toBe(true);
  });

  it("treats 4xx (other than the listed) as non-transient", () => {
    expect(isTransientStatus(400)).toBe(false);
    expect(isTransientStatus(401)).toBe(false);
    expect(isTransientStatus(403)).toBe(false);
    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(422)).toBe(false);
  });

  it("treats 2xx / 3xx as non-transient", () => {
    expect(isTransientStatus(200)).toBe(false);
    expect(isTransientStatus(204)).toBe(false);
    expect(isTransientStatus(301)).toBe(false);
  });
});

describe("ApiError", () => {
  it("carries status, message, and optional body", () => {
    const err = new ApiError("oops", 500, "raw text");
    expect(err.status).toBe(500);
    expect(err.message).toBe("oops");
    expect(err.body).toBe("raw text");
    expect(err.name).toBe("ApiError");
  });

  it(".transient reflects isTransientStatus", () => {
    expect(new ApiError("x", 0).transient).toBe(true);
    expect(new ApiError("x", 500).transient).toBe(true);
    expect(new ApiError("x", 400).transient).toBe(false);
  });
});
