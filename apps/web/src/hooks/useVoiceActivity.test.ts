import { describe, expect, it } from "vitest";

import {
  resolveVoiceActivityPhase,
  voiceActivityLabel,
  type VoiceActivityInput,
} from "./useVoiceActivity";

function input(
  partial: Partial<VoiceActivityInput> = {},
): VoiceActivityInput {
  return {
    sttListening: false,
    sttInterim: "",
    vadSpeaking: false,
    ttsSpeaking: false,
    activeTurnId: null,
    partialText: "",
    pendingToolCount: 0,
    ...partial,
  };
}

describe("resolveVoiceActivityPhase", () => {
  it("returns idle when nothing is active", () => {
    expect(resolveVoiceActivityPhase(input())).toBe("idle");
  });

  it("prioritizes senecaSpeaking over user and turn states", () => {
    expect(
      resolveVoiceActivityPhase(
        input({
          ttsSpeaking: true,
          sttListening: true,
          activeTurnId: "t1",
          partialText: "hello",
        }),
      ),
    ).toBe("senecaSpeaking");
  });

  it("detects userListening vs userDictating", () => {
    expect(
      resolveVoiceActivityPhase(input({ sttListening: true })),
    ).toBe("userListening");
    expect(
      resolveVoiceActivityPhase(
        input({ sttListening: true, sttInterim: "hi" }),
      ),
    ).toBe("userDictating");
    expect(
      resolveVoiceActivityPhase(input({ vadSpeaking: true })),
    ).toBe("userListening");
  });

  it("prioritizes user over seneca turn sub-phases", () => {
    expect(
      resolveVoiceActivityPhase(
        input({
          sttListening: true,
          sttInterim: "draft",
          activeTurnId: "t1",
          partialText: "still streaming",
        }),
      ),
    ).toBe("userDictating");
  });

  it("resolves seneca working sub-phases", () => {
    expect(
      resolveVoiceActivityPhase(
        input({ activeTurnId: "t1", partialText: "…" }),
      ),
    ).toBe("senecaStreaming");
    expect(
      resolveVoiceActivityPhase(
        input({ activeTurnId: "t1", pendingToolCount: 2 }),
      ),
    ).toBe("senecaTooling");
    expect(
      resolveVoiceActivityPhase(input({ activeTurnId: "t1" })),
    ).toBe("senecaThinking");
  });

  it("prioritizes tooling over streaming when tools are in flight", () => {
    expect(
      resolveVoiceActivityPhase(
        input({
          activeTurnId: "t1",
          partialText: "partial answer on screen",
          pendingToolCount: 1,
        }),
      ),
    ).toBe("senecaTooling");
  });

  it("treats TTS pipeline active as senecaSpeaking even without partial text", () => {
    expect(
      resolveVoiceActivityPhase(
        input({
          ttsSpeaking: true,
          activeTurnId: "t1",
          partialText: "",
          pendingToolCount: 2,
        }),
      ),
    ).toBe("senecaSpeaking");
  });
});

describe("voiceActivityLabel", () => {
  it("returns human-readable labels for active phases", () => {
    expect(voiceActivityLabel("senecaStreaming")).toBe("Seneca is writing");
    expect(voiceActivityLabel("idle")).toBeNull();
  });
});
