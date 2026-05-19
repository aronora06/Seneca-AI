/**
 * ThemeProvider — light/dark mode, colour palettes, font scale, and
 * background texture.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  readPrefs,
  subscribePrefs,
  writePrefs,
  type BackgroundStyle,
  type FontSize,
} from "../lib/userPreferences";
import {
  applyBackgroundStyle,
  applyFontSize,
  applyModeClass,
  applyPalette,
  resolveThemeChoice,
  type ResolvedTheme,
  type ThemeChoice,
} from "./applyTheme";
import { DEFAULT_PALETTE_ID } from "./palettes";
import type { SemanticTokens } from "./tokens";

export type { ResolvedTheme, ThemeChoice };

interface ThemeContextValue {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
  paletteId: string;
  setPaletteId: (id: string) => void;
  paletteOverrides: Partial<SemanticTokens> | null;
  setPaletteOverrides: (overrides: Partial<SemanticTokens> | null) => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  backgroundStyle: BackgroundStyle;
  setBackgroundStyle: (style: BackgroundStyle) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "seneca:theme";

function readStoredChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

function applyAll(
  resolved: ResolvedTheme,
  paletteId: string,
  paletteOverrides: Partial<SemanticTokens> | null,
  fontSize: FontSize,
  backgroundStyle: BackgroundStyle,
): void {
  applyModeClass(resolved);
  applyPalette(paletteId, resolved, paletteOverrides);
  applyFontSize(fontSize);
  applyBackgroundStyle(backgroundStyle);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initialPrefs = readPrefs();
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveThemeChoice(readStoredChoice()),
  );
  const [paletteId, setPaletteIdState] = useState(
    initialPrefs.paletteId || DEFAULT_PALETTE_ID,
  );
  const [paletteOverrides, setPaletteOverridesState] = useState<
    Partial<SemanticTokens> | null
  >(initialPrefs.paletteOverrides);
  const [fontSize, setFontSizeState] = useState<FontSize>(initialPrefs.fontSize);
  const [backgroundStyle, setBackgroundStyleState] = useState<BackgroundStyle>(
    initialPrefs.backgroundStyle,
  );

  useEffect(() => {
    applyAll(resolved, paletteId, paletteOverrides, fontSize, backgroundStyle);
  }, [choice, resolved, paletteId, paletteOverrides, fontSize, backgroundStyle]);

  useEffect(() => {
    if (choice !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      const next = resolveThemeChoice("system");
      setResolved(next);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [choice]);

  // Re-sync when prefs change from another panel / tab.
  useEffect(() => {
    return subscribePrefs(() => {
      const p = readPrefs();
      setPaletteIdState(p.paletteId || DEFAULT_PALETTE_ID);
      setPaletteOverridesState(p.paletteOverrides);
      setFontSizeState(p.fontSize);
      setBackgroundStyleState(p.backgroundStyle);
    });
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    setResolved(resolveThemeChoice(next));
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const setPaletteId = useCallback((id: string) => {
    setPaletteIdState(id);
    writePrefs({ paletteId: id, paletteOverrides: null });
    setPaletteOverridesState(null);
  }, []);

  const setPaletteOverrides = useCallback(
    (overrides: Partial<SemanticTokens> | null) => {
      setPaletteOverridesState(overrides);
      writePrefs({ paletteOverrides: overrides });
    },
    [],
  );

  const setFontSize = useCallback((size: FontSize) => {
    setFontSizeState(size);
    writePrefs({ fontSize: size });
  }, []);

  const setBackgroundStyle = useCallback((style: BackgroundStyle) => {
    setBackgroundStyleState(style);
    writePrefs({ backgroundStyle: style });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      choice,
      resolved,
      setChoice,
      paletteId,
      setPaletteId,
      paletteOverrides,
      setPaletteOverrides,
      fontSize,
      setFontSize,
      backgroundStyle,
      setBackgroundStyle,
    }),
    [
      choice,
      resolved,
      setChoice,
      paletteId,
      setPaletteId,
      paletteOverrides,
      setPaletteOverrides,
      fontSize,
      setFontSize,
      backgroundStyle,
      setBackgroundStyle,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
