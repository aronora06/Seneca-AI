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

export interface CustomInstructions {
  aboutYou: string;
  howToRespond: string;
}

export type FontSize = "sm" | "md" | "lg";
export type BackgroundStyle = "gradient" | "flat" | "paper" | "grid";
export type InputModeDefault = "push-to-talk" | "continuous" | "text-only";

export interface UserPreferences {
  displayName: string;
  accentId: string;
  fontSize: FontSize;
  backgroundStyle: BackgroundStyle;
  ttsVoiceURI: string | null;
  ttsRate: number;
  ttsPitch: number;
  ttsAutoPlay: boolean;
  inputModeDefault: InputModeDefault;
  customInstructions: CustomInstructions;
}

export const DEFAULTS: UserPreferences = {
  displayName: "",
  accentId: "ember",
  fontSize: "md",
  backgroundStyle: "gradient",
  ttsVoiceURI: null,
  ttsRate: 1.0,
  ttsPitch: 1.0,
  ttsAutoPlay: true,
  inputModeDefault: "push-to-talk",
  customInstructions: { aboutYou: "", howToRespond: "" },
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

function merge(raw: Partial<UserPreferences>): UserPreferences {
  return {
    displayName:
      typeof raw.displayName === "string" ? raw.displayName : DEFAULTS.displayName,
    accentId:
      typeof raw.accentId === "string" ? raw.accentId : DEFAULTS.accentId,
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
