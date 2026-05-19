import type { BackgroundStyle, FontSize } from "../lib/userPreferences";
import { resolvePaletteTokens } from "./palettes";
import { applySemanticTokens, type SemanticTokens } from "./tokens";

export type ResolvedTheme = "light" | "dark";
export type ThemeChoice = "light" | "dark" | "system";

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveThemeChoice(choice: ThemeChoice): ResolvedTheme {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

export function applyModeClass(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;
}

const FONT_SCALE: Record<FontSize, string> = {
  sm: "0.875",
  md: "1",
  lg: "1.125",
};

export function applyFontSize(size: FontSize): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--font-scale",
    FONT_SCALE[size],
  );
}

export function applyBackgroundStyle(style: BackgroundStyle): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("app-backdrop");
  if (!el) return;
  if (style === "gradient") {
    el.removeAttribute("data-bg");
  } else {
    el.setAttribute("data-bg", style);
  }
}

export function applyPalette(
  paletteId: string,
  resolved: ResolvedTheme,
  overrides: Partial<SemanticTokens> | null | undefined,
): SemanticTokens {
  const tokens = resolvePaletteTokens(paletteId, resolved, overrides);
  applySemanticTokens(tokens);
  return tokens;
}
