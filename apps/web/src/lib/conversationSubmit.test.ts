import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STT_INTERIM_POLL_MS,
  VAD_SUBMIT_TAIL_MS,
  cancelConversationModeSubmit,
  scheduleConversationModeSubmit,
} from "./conversationSubmit";

describe("scheduleConversationModeSubmit", () => {
  const timer = { current: null as number | null };

  beforeEach(() => {
    vi.useFakeTimers();
    timer.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits after the tail delay when interim is already empty", () => {
    const submit = vi.fn();
    scheduleConversationModeSubmit({
      getPendingText: () => "hello world",
      getSttInterim: () => "",
      submit,
      timer,
    });

    vi.advanceTimersByTime(VAD_SUBMIT_TAIL_MS - 1);
    expect(submit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(submit).toHaveBeenCalledWith("hello world");
  });

  it("waits for STT interim to drain before submitting", () => {
    const submit = vi.fn();
    let interim = "still typing";

    scheduleConversationModeSubmit({
      getPendingText: () => "final text",
      getSttInterim: () => interim,
      submit,
      timer,
    });

    vi.advanceTimersByTime(VAD_SUBMIT_TAIL_MS);
    expect(submit).not.toHaveBeenCalled();

    interim = "";
    vi.advanceTimersByTime(STT_INTERIM_POLL_MS);
    expect(submit).toHaveBeenCalledWith("final text");
  });

  it("cancels a pending submit", () => {
    const submit = vi.fn();
    scheduleConversationModeSubmit({
      getPendingText: () => "nope",
      getSttInterim: () => "",
      submit,
      timer,
    });
    cancelConversationModeSubmit(timer);
    vi.advanceTimersByTime(VAD_SUBMIT_TAIL_MS + 500);
    expect(submit).not.toHaveBeenCalled();
  });
});
