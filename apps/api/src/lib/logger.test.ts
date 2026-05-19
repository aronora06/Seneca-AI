/**
 * Phase F — logger redaction + level filtering tests.
 */

import { describe, expect, it } from "vitest";

import { _internals } from "./logger.js";

describe("logger.redact", () => {
  it("redacts authorization-shaped keys", () => {
    const out = _internals.redact({
      email: "a@b.c",
      jwt: "secret-jwt",
      apiToken: "shhh",
      mySecretField: "shhh",
      authorization: "Bearer ...",
      ok: "kept",
    });
    expect(out).toEqual({
      email: "[redacted]",
      jwt: "[redacted]",
      apiToken: "[redacted]",
      mySecretField: "[redacted]",
      authorization: "[redacted]",
      ok: "kept",
    });
  });

  it("recurses into nested objects and arrays", () => {
    const out = _internals.redact({
      nested: { email: "x@y.z", id: 1 },
      arr: [{ jwt: "abc" }, { ok: true }],
    });
    expect(out).toEqual({
      nested: { email: "[redacted]", id: 1 },
      arr: [{ jwt: "[redacted]" }, { ok: true }],
    });
  });

  it("handles primitives and nullish values", () => {
    expect(_internals.redact(null)).toBeNull();
    expect(_internals.redact(undefined)).toBeUndefined();
    expect(_internals.redact("hello")).toBe("hello");
    expect(_internals.redact(42)).toBe(42);
    expect(_internals.redact(true)).toBe(true);
  });
});
