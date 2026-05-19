/**
 * Phase F — daily cost cap accumulator tests.
 */

import { afterEach, describe, expect, it } from "vitest";

import { env } from "../env.js";
import {
  __resetCostCapForTests,
  assertWithinDailyCap,
  peekDailyCost,
  recordDailyCost,
} from "./costCap.js";

const mutableEnv = env as { costCapUsdPerDay: number };
const originalCap = mutableEnv.costCapUsdPerDay;

afterEach(() => {
  __resetCostCapForTests();
  mutableEnv.costCapUsdPerDay = originalCap;
});

describe("peekDailyCost", () => {
  it("returns zero usage for a fresh user", () => {
    const state = peekDailyCost("user-fresh");
    expect(state.used).toBe(0);
    expect(state.exceeded).toBe(false);
    expect(state.resetInSec).toBeGreaterThanOrEqual(0);
  });

  it("accumulates spend across calls", () => {
    recordDailyCost("user-a", 0.25);
    recordDailyCost("user-a", 0.5);
    const state = peekDailyCost("user-a");
    expect(state.used).toBeCloseTo(0.75, 5);
  });

  it("flags exceeded once the cap is hit", () => {
    mutableEnv.costCapUsdPerDay = 1;
    recordDailyCost("user-b", 0.9);
    expect(peekDailyCost("user-b").exceeded).toBe(false);
    recordDailyCost("user-b", 0.2);
    expect(peekDailyCost("user-b").exceeded).toBe(true);
  });

  it("disables the cap when env.costCapUsdPerDay is 0", () => {
    mutableEnv.costCapUsdPerDay = 0;
    recordDailyCost("user-c", 100);
    expect(peekDailyCost("user-c").exceeded).toBe(false);
  });
});

describe("assertWithinDailyCap", () => {
  it("is a no-op when the user is under the cap", () => {
    mutableEnv.costCapUsdPerDay = 10;
    recordDailyCost("user-d", 1);
    expect(() => assertWithinDailyCap("user-d")).not.toThrow();
  });

  it("throws a tagged error when exceeded", () => {
    mutableEnv.costCapUsdPerDay = 0.5;
    recordDailyCost("user-e", 1);
    try {
      assertWithinDailyCap("user-e");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const tagged = err as Error & { code?: string; httpStatus?: number };
      expect(tagged.code).toBe("cost_capped");
      expect(tagged.httpStatus).toBe(403);
    }
  });
});

describe("recordDailyCost", () => {
  it("ignores non-positive deltas", () => {
    recordDailyCost("user-f", -1);
    recordDailyCost("user-f", 0);
    recordDailyCost("user-f", NaN);
    expect(peekDailyCost("user-f").used).toBe(0);
  });
});
