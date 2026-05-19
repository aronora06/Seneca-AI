/**
 * Unified voice-activity phase for directional UI indicators.
 */

import { useMemo } from "react";

import { usePrefs } from "../lib/userPreferences";
import { useSenecaStore } from "../store/seneca";
import { useReducedMotion } from "./useReducedMotion";

export type VoiceActivityPhase =
  | "idle"
  | "userListening"
  | "userDictating"
  | "senecaSpeaking"
  | "senecaStreaming"
  | "senecaTooling"
  | "senecaThinking";

export interface VoiceActivityInput {
  sttListening: boolean;
  sttInterim: string;
  vadSpeaking: boolean;
  /**
   * TTS pipeline active (queued, fetching, or playing). Prefer
   * `audioActive` from `useSpeech` over audible `speaking` alone.
   */
  ttsSpeaking: boolean;
  activeTurnId: string | null;
  partialText: string;
  pendingToolCount: number;
}

export function resolveVoiceActivityPhase(
  input: VoiceActivityInput,
): VoiceActivityPhase {
  if (input.ttsSpeaking) return "senecaSpeaking";

  const userActive =
    input.sttListening || input.vadSpeaking;
  if (userActive) {
    return input.sttInterim.trim().length > 0
      ? "userDictating"
      : "userListening";
  }

  if (!input.activeTurnId) return "idle";

  if (input.pendingToolCount > 0) return "senecaTooling";
  if (input.partialText.trim().length > 0) return "senecaStreaming";
  return "senecaThinking";
}

export function voiceActivityLabel(phase: VoiceActivityPhase): string | null {
  switch (phase) {
    case "userListening":
      return "Listening to you";
    case "userDictating":
      return "Hearing you";
    case "senecaSpeaking":
      return "Seneca is speaking";
    case "senecaStreaming":
      return "Seneca is writing";
    case "senecaTooling":
      return "Seneca is using tools";
    case "senecaThinking":
      return "Seneca is thinking";
    default:
      return null;
  }
}

export function useVoiceActivity(input: VoiceActivityInput) {
  const prefs = usePrefs();
  const reducedMotion = useReducedMotion();

  const phase = useMemo(
    () => resolveVoiceActivityPhase(input),
    [
      input.sttListening,
      input.sttInterim,
      input.vadSpeaking,
      input.ttsSpeaking,
      input.activeTurnId,
      input.partialText,
      input.pendingToolCount,
    ],
  );

  const fancyEnabled = prefs.voiceVisualEffects && !reducedMotion;
  const showFancy = fancyEnabled;
  const label = voiceActivityLabel(phase);

  const userActive =
    phase === "userListening" || phase === "userDictating";
  const senecaWorking =
    phase === "senecaThinking" ||
    phase === "senecaStreaming" ||
    phase === "senecaTooling";
  const senecaSpeaking = phase === "senecaSpeaking";

  return {
    phase,
    label,
    fancyEnabled,
    showFancy,
    reducedMotion,
    userActive,
    senecaWorking,
    senecaSpeaking,
  };
}

/** Convenience selector bundle from the Seneca store + STT/TTS hooks. */
export function useVoiceActivityFromStore(input: {
  sttListening: boolean;
  sttInterim: string;
  vadSpeaking: boolean;
  ttsSpeaking: boolean;
}) {
  const activeTurnId = useSenecaStore((s) => s.streaming.activeTurnId);
  const partialText = useSenecaStore((s) => s.streaming.partialText);
  const pendingToolCount = useSenecaStore(
    (s) => s.streaming.pendingActionLog.length,
  );

  return useVoiceActivity({
    ...input,
    activeTurnId,
    partialText,
    pendingToolCount,
  });
}
