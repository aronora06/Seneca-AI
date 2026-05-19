/**
 * Phase F — toast store tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __getToastsForTests,
  clearToasts,
  dismiss,
  subscribeToasts,
  toast,
} from "./toastStore";

beforeEach(() => {
  clearToasts();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  clearToasts();
});

describe("toast store", () => {
  it("pushes a toast and emits to subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeToasts(listener);
    toast.info("Hello");
    expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({ kind: "info", title: "Hello" }),
    ]);
    expect(__getToastsForTests()).toHaveLength(1);
    unsub();
  });

  it("supports object input with description and action", () => {
    toast.error({
      title: "Boom",
      description: "Something exploded",
      actionLabel: "Retry",
      onAction: () => {},
    });
    const t = __getToastsForTests()[0]!;
    expect(t.kind).toBe("error");
    expect(t.description).toBe("Something exploded");
    expect(t.actionLabel).toBe("Retry");
  });

  it("auto-dismisses after durationMs", () => {
    toast.success({ title: "x", durationMs: 1_000 });
    expect(__getToastsForTests()).toHaveLength(1);
    vi.advanceTimersByTime(1_001);
    expect(__getToastsForTests()).toHaveLength(0);
  });

  it("respects durationMs: null (never auto-dismisses)", () => {
    toast.info({ title: "sticky", durationMs: null });
    vi.advanceTimersByTime(60_000);
    expect(__getToastsForTests()).toHaveLength(1);
  });

  it("dismiss removes a specific toast", () => {
    const id = toast.info("hello");
    toast.info("world");
    dismiss(id);
    const remaining = __getToastsForTests();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.title).toBe("world");
  });

  it("clear empties the store", () => {
    toast.info("a");
    toast.info("b");
    toast.info("c");
    clearToasts();
    expect(__getToastsForTests()).toHaveLength(0);
  });

  it("subscriber receives the current state on subscribe", () => {
    toast.info("preloaded");
    const listener = vi.fn();
    const unsub = subscribeToasts(listener);
    expect(listener).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ title: "preloaded" })]),
    );
    unsub();
  });
});
