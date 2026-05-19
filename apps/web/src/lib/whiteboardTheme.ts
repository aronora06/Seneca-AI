/**
 * Whiteboard surface colours derived from the active UI theme.
 * Shared by WhiteboardTab (rendering) and workspaceContext (agent prompt).
 */

import {
  resolveThemeChoice,
  type ResolvedTheme,
  type ThemeChoice,
} from "../theme/applyTheme";

const THEME_STORAGE_KEY = "seneca:theme";

const WHITEBOARD_BG_FALLBACK = { light: "#f8f6f1", dark: "#0e0a06" } as const;
export const WHITEBOARD_STROKE_DEFAULT = {
  light: "#1e1e1e",
  dark: "#e8e8e8",
} as const;

const whiteboardBgCache: Partial<Record<ResolvedTheme, string>> = {};

export function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

export function readResolvedTheme(): ResolvedTheme {
  return resolveThemeChoice(readThemeChoice());
}

export function getWhiteboardBackgroundColor(
  theme: ResolvedTheme = readResolvedTheme(),
): string {
  const cached = whiteboardBgCache[theme];
  if (cached) return cached;
  if (typeof window === "undefined" || typeof document === "undefined") {
    return WHITEBOARD_BG_FALLBACK[theme];
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--c-surface")
    .trim();
  const hex = rgbTripletToHex(raw) ?? WHITEBOARD_BG_FALLBACK[theme];
  whiteboardBgCache[theme] = hex;
  return hex;
}

export function recommendedStrokeForTheme(
  theme: ResolvedTheme = readResolvedTheme(),
): string {
  return WHITEBOARD_STROKE_DEFAULT[theme];
}

export function recommendedStrokeForBackground(bgHex: string): string {
  return relativeLuminanceHex(bgHex) > 0.45
    ? WHITEBOARD_STROKE_DEFAULT.light
    : WHITEBOARD_STROKE_DEFAULT.dark;
}

/**
 * If `strokeHex` has poor contrast on `bgHex`, return a readable default.
 */
export function ensureReadableStroke(
  strokeHex: string | undefined,
  bgHex: string,
): string {
  const candidate = strokeHex ?? recommendedStrokeForBackground(bgHex);
  if (contrastRatioHex(candidate, bgHex) >= 4.5) return candidate;
  return recommendedStrokeForBackground(bgHex);
}

export function invalidateWhiteboardBgCache(): void {
  whiteboardBgCache.light = undefined;
  whiteboardBgCache.dark = undefined;
}

function rgbTripletToHex(raw: string): string | null {
  const match = raw.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (!match) return null;
  const r = clampByte(Number(match[1]));
  const g = clampByte(Number(match[2]));
  const b = clampByte(Number(match[3]));
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminanceHex(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatioHex(fg: string, bg: string): number {
  const l1 = relativeLuminanceHex(fg);
  const l2 = relativeLuminanceHex(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
