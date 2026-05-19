import { beforeEach, describe, expect, it, vi } from "vitest";

describe("ttsTimeline", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.removeItem("seneca:ttsDebug");
  });

  it("logs non-negative monotonic ms timestamps when debug is enabled", async () => {
    localStorage.setItem("seneca:ttsDebug", "1");
    const { ttsLog, ttsLogElapsedMs } = await import("./ttsTimeline");

    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    const t0 = ttsLogElapsedMs();
    expect(t0).toBeGreaterThanOrEqual(0);

    ttsLog("test.a");
    await new Promise((r) => setTimeout(r, 5));
    ttsLog("test.b");

    expect(debugSpy).toHaveBeenCalledTimes(2);
    const first = debugSpy.mock.calls[0]![1] as { ms: number };
    const second = debugSpy.mock.calls[1]![1] as { ms: number };
    expect(first.ms).toBeGreaterThanOrEqual(0);
    expect(second.ms).toBeGreaterThanOrEqual(first.ms);

    debugSpy.mockRestore();
  });
});
