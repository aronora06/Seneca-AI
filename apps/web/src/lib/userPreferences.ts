/**
 * Client-side user preferences stored in localStorage under a single key.
 *
 * Includes a tiny pub/sub layer so any component can subscribe to changes
 * and re-render — use `usePrefs()` from React. Internal panel state can
 * still call `readPrefs()` once at mount and `writePrefs()` to save,
 * since `writePrefs()` notifies all subscribers automatically.
 *
 * Theme-mode (light/dark/system) stays in ThemeProvider's own key to avoid
 * duplicating that state.
 */

import { useSyncExternalStore } from "react";
import type { SemanticTokens } from "../theme/tokens";
import { DEFAULT_PALETTE_ID } from "../theme/palettes";

export interface CustomInstructions {
  aboutYou: string;
  howToRespond: string;
}

export type FontSize = "sm" | "md" | "lg";
export type BackgroundStyle = "gradient" | "flat" | "paper" | "grid";
export type InputModeDefault = "push-to-talk" | "continuous" | "text-only";

/**
 * Phase A — Vision lock.
 *
 * "off"    — the eye starts off for every new session (today's default).
 * "once"   — the eye is armed for the first message of every new
 *            session, then auto-reverts after that turn.
 * "locked" — the eye stays on across every turn of every new session
 *            until the user explicitly switches it off.
 *
 * The user can always flip mid-conversation via the segmented control;
 * this preference only seeds the initial state on session load.
 */
export type VisionDefault = "off" | "once" | "locked";

export interface UserPreferences {
  displayName: string;
  /** @deprecated Use paletteId — kept for legacy localStorage blobs. */
  accentId: string;
  /** Colour palette preset id (see theme/palettes.ts). */
  paletteId: string;
  /** Per-token overrides applied on top of the selected palette. */
  paletteOverrides: Partial<SemanticTokens> | null;
  fontSize: FontSize;
  backgroundStyle: BackgroundStyle;
  /** Browser-TTS voice URI (legacy fallback path). */
  ttsVoiceURI: string | null;
  /**
   * Phase C — ElevenLabs voice id. Null means "use the server's
   * default". Distinct from `ttsVoiceURI` because ElevenLabs IDs are
   * 22-char opaque tokens, not URIs.
   */
  ttsVoiceId: string | null;
  /**
   * Phase C — premium TTS provider preference. "auto" picks ElevenLabs
   * when available and falls back to the browser engine; "browser"
   * forces the browser engine even when ElevenLabs is configured.
   */
  ttsProvider: "auto" | "browser";
  ttsRate: number;
  ttsPitch: number;
  ttsAutoPlay: boolean;
  inputModeDefault: InputModeDefault;
  visionDefault: VisionDefault;
  /**
   * Phase B — dictation surface.
   *
   * When true (default), final STT results stream into the text input
   * box and the user reviews / edits before pressing Send / Enter.
   * When false ("hands-free"), final STT results auto-submit just like
   * today's behaviour. The pane exposes a per-session toggle for the
   * same setting.
   */
  editBeforeSend: boolean;
  /**
   * Phase B — voice activity detection for the hands-free path. When
   * true (default), STT auto-submits ~1.5s after the user stops talking.
   * Ignored unless `editBeforeSend` is false and continuous listening
   * is on.
   */
  vadEnabled: boolean;
  /**
   * Phase B — push-to-talk keyboard shortcut. Hold the key to capture,
   * release to stop. Disabled while an editable input is focused so the
   * user can still type. Default is the spacebar (" "). Any single
   * key value accepted by `KeyboardEvent.key` is valid.
   */
  pttKey: string;
  customInstructions: CustomInstructions;
  /**
   * Phase F — onboarding hint dismissal. The hint shows once on
   * boot for a brand-new local; clicking "Got it" sets this to
   * true so we never re-show it.
   */
  onboardingDismissed: boolean;
  /**
   * Phase G — Conversation Mode (hands-free with Silero VAD).
   *
   * When true, a real voice-activity detector (Silero VAD via
   * @ricky0123/vad-web) gates the recognizer and the barge-in
   * trigger, replacing the brittle "interim text growing" heuristic.
   * This is the mode users want for actual hands-free conversation:
   * speak whenever you want, Seneca yields the moment you start
   * talking, no buttons to press. Off by default so existing users
   * see the same behaviour until they opt in.
   */
  conversationMode: boolean;
  /**
   * Phase G — one-time hint pointing at the new Conversation Mode
   * button in the floating voice dock. Set to true the first time
   * the user either toggles the mode on or dismisses the hint.
   */
  conversationModeHintDismissed: boolean;
  /** Last position of the floating voice dock (workspace-local px). */
  floatingVoicePosition: { x: number; y: number } | null;
  /**
   * Directional waveforms and activity beacons in the voice pane.
   * When false, only minimal status dots are shown.
   */
  voiceVisualEffects: boolean;
}

export const DEFAULTS: UserPreferences = {
  displayName: "",
  accentId: "ember",
  paletteId: DEFAULT_PALETTE_ID,
  paletteOverrides: null,
  fontSize: "md",
  backgroundStyle: "gradient",
  ttsVoiceURI: null,
  ttsVoiceId: null,
  ttsProvider: "auto",
  ttsRate: 1.0,
  ttsPitch: 1.0,
  ttsAutoPlay: true,
  inputModeDefault: "push-to-talk",
  visionDefault: "off",
  editBeforeSend: true,
  vadEnabled: true,
  pttKey: " ",
  customInstructions: { aboutYou: "", howToRespond: "" },
  onboardingDismissed: false,
  conversationMode: false,
  conversationModeHintDismissed: false,
  floatingVoicePosition: null,
  voiceVisualEffects: true,
};

const STORAGE_KEY = "seneca:prefs";

export function readPrefs(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return merge(parsed);
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Patch shape — every top-level key is optional, and customInstructions
 * lets you update one of its sub-fields without clobbering the other.
 */
export type PrefsPatch = Partial<Omit<UserPreferences, "customInstructions">> & {
  customInstructions?: Partial<CustomInstructions>;
};

export function writePrefs(partial: PrefsPatch): UserPreferences {
  const current = readPrefs();
  const next: UserPreferences = {
    ...current,
    ...partial,
    customInstructions: {
      ...current.customInstructions,
      ...(partial.customInstructions ?? {}),
    },
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be full or disabled
  }
  notify();
  return next;
}

// ── Subscription layer ──────────────────────────────────────────────
// Lets React components re-render when prefs change in any other component.
//
// Snapshot is cached between writes so React.useSyncExternalStore sees
// a stable reference and doesn't loop. The cache is invalidated inside
// writePrefs() via notify().

const listeners = new Set<() => void>();
let cachedSnapshot: UserPreferences | null = null;

function notify(): void {
  cachedSnapshot = null;
  for (const fn of listeners) fn();
}

function getSnapshot(): UserPreferences {
  if (cachedSnapshot === null) {
    cachedSnapshot = readPrefs();
  }
  return cachedSnapshot;
}

export function subscribePrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * React hook that returns the current preferences and re-renders the
 * component whenever any pref changes. Use this in components that need
 * to display values the user can change from anywhere in the app
 * (e.g. the header avatar's display name).
 */
export function usePrefs(): UserPreferences {
  return useSyncExternalStore(subscribePrefs, getSnapshot, () => DEFAULTS);
}

const TOKEN_KEYS: (keyof SemanticTokens)[] = [
  "surface",
  "surfaceSunk",
  "card",
  "border",
  "fg",
  "fgMuted",
  "fgSubtle",
  "fgOn",
  "accent",
  "accentSoft",
  "accentFg",
  "danger",
  "dangerSoft",
  "dangerFg",
  "ok",
  "okSoft",
];

function isRgbTriple(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const parts = v.trim().split(/\s+/);
  if (parts.length !== 3) return false;
  return parts.every((p) => {
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function mergeFloatingVoicePosition(
  raw: unknown,
): { x: number; y: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { x?: unknown; y?: unknown };
  if (typeof o.x !== "number" || typeof o.y !== "number") return null;
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  return { x: o.x, y: o.y };
}

function mergePaletteOverrides(
  raw: unknown,
): Partial<SemanticTokens> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const out: Partial<SemanticTokens> = {};
  for (const key of TOKEN_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (isRgbTriple(v)) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function merge(raw: Partial<UserPreferences>): UserPreferences {
  return {
    displayName:
      typeof raw.displayName === "string" ? raw.displayName : DEFAULTS.displayName,
    accentId:
      typeof raw.accentId === "string" ? raw.accentId : DEFAULTS.accentId,
    paletteId:
      typeof raw.paletteId === "string" && raw.paletteId.length > 0
        ? raw.paletteId
        : DEFAULTS.paletteId,
    paletteOverrides: mergePaletteOverrides(raw.paletteOverrides),
    fontSize:
      raw.fontSize === "sm" || raw.fontSize === "md" || raw.fontSize === "lg"
        ? raw.fontSize
        : DEFAULTS.fontSize,
    backgroundStyle:
      raw.backgroundStyle === "gradient" ||
      raw.backgroundStyle === "flat" ||
      raw.backgroundStyle === "paper" ||
      raw.backgroundStyle === "grid"
        ? raw.backgroundStyle
        : DEFAULTS.backgroundStyle,
    ttsVoiceURI:
      typeof raw.ttsVoiceURI === "string" ? raw.ttsVoiceURI : DEFAULTS.ttsVoiceURI,
    ttsVoiceId:
      typeof raw.ttsVoiceId === "string" && raw.ttsVoiceId.length > 0
        ? raw.ttsVoiceId
        : DEFAULTS.ttsVoiceId,
    ttsProvider:
      raw.ttsProvider === "auto" || raw.ttsProvider === "browser"
        ? raw.ttsProvider
        : DEFAULTS.ttsProvider,
    ttsRate:
      typeof raw.ttsRate === "number" && raw.ttsRate >= 0.5 && raw.ttsRate <= 2
        ? raw.ttsRate
        : DEFAULTS.ttsRate,
    ttsPitch:
      typeof raw.ttsPitch === "number" && raw.ttsPitch >= 0 && raw.ttsPitch <= 2
        ? raw.ttsPitch
        : DEFAULTS.ttsPitch,
    ttsAutoPlay:
      typeof raw.ttsAutoPlay === "boolean" ? raw.ttsAutoPlay : DEFAULTS.ttsAutoPlay,
    inputModeDefault:
      raw.inputModeDefault === "push-to-talk" ||
      raw.inputModeDefault === "continuous" ||
      raw.inputModeDefault === "text-only"
        ? raw.inputModeDefault
        : DEFAULTS.inputModeDefault,
    visionDefault:
      raw.visionDefault === "off" ||
      raw.visionDefault === "once" ||
      raw.visionDefault === "locked"
        ? raw.visionDefault
        : DEFAULTS.visionDefault,
    editBeforeSend:
      typeof raw.editBeforeSend === "boolean"
        ? raw.editBeforeSend
        : DEFAULTS.editBeforeSend,
    vadEnabled:
      typeof raw.vadEnabled === "boolean" ? raw.vadEnabled : DEFAULTS.vadEnabled,
    pttKey:
      typeof raw.pttKey === "string" && raw.pttKey.length > 0
        ? raw.pttKey
        : DEFAULTS.pttKey,
    onboardingDismissed:
      typeof raw.onboardingDismissed === "boolean"
        ? raw.onboardingDismissed
        : DEFAULTS.onboardingDismissed,
    conversationMode:
      typeof raw.conversationMode === "boolean"
        ? raw.conversationMode
        : DEFAULTS.conversationMode,
    conversationModeHintDismissed:
      typeof raw.conversationModeHintDismissed === "boolean"
        ? raw.conversationModeHintDismissed
        : DEFAULTS.conversationModeHintDismissed,
    floatingVoicePosition: mergeFloatingVoicePosition(raw.floatingVoicePosition),
    voiceVisualEffects:
      typeof raw.voiceVisualEffects === "boolean"
        ? raw.voiceVisualEffects
        : DEFAULTS.voiceVisualEffects,
    customInstructions: {
      aboutYou:
        typeof raw.customInstructions?.aboutYou === "string"
          ? raw.customInstructions.aboutYou
          : DEFAULTS.customInstructions.aboutYou,
      howToRespond:
        typeof raw.customInstructions?.howToRespond === "string"
          ? raw.customInstructions.howToRespond
          : DEFAULTS.customInstructions.howToRespond,
    },
  };
}
