/**
 * ThemeProvider — single source of truth for light/dark mode, accent
 * colour, and font-size scale.
 *
 * Light/dark settings:
 *   - "light" / "dark" — pinned by the user
 *   - "system" — follow `prefers-color-scheme`
 *
 * Accent colours and font-size come from userPreferences (localStorage).
 * When they change, the corresponding CSS custom properties are written
 * directly to `document.documentElement.style`.
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
import { getAccent } from "./accents";
import {
  readPrefs,
  writePrefs,
  type BackgroundStyle,
  type FontSize,
} from "../lib/userPreferences";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
  accentId: string;
  setAccentId: (id: string) => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
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

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(choice: ThemeChoice): ResolvedTheme {
  if (choice === "system") return systemPrefersDark() ? "dark" : "light";
  return choice;
}

function applyDomClass(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
}

function applyAccentVars(accentId: string, resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const palette = getAccent(accentId);
  const vals = resolved === "dark" ? palette.dark : palette.light;
  const s = document.documentElement.style;
  s.setProperty("--c-accent", vals.accent);
  s.setProperty("--c-accent-soft", vals.accentSoft);
  s.setProperty("--c-accent-fg", vals.accentFg);
}

const FONT_SCALE: Record<FontSize, string> = {
  sm: "0.875",
  md: "1",
  lg: "1.125",
};

function applyFontSize(size: FontSize): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--font-scale",
    FONT_SCALE[size],
  );
}

function applyBackgroundStyle(style: BackgroundStyle): void {
  if (typeof document === "undefined") return;
  if (style === "gradient") {
    document.body.removeAttribute("data-bg");
  } else {
    document.body.setAttribute("data-bg", style);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readStoredChoice()));

  const prefs = readPrefs();
  const [accentId, setAccentIdState] = useState(prefs.accentId);
  const [fontSize, setFontSizeState] = useState<FontSize>(prefs.fontSize);

  // Apply DOM classes and CSS vars on first render.
  useEffect(() => {
    applyDomClass(resolved);
    applyAccentVars(accentId, resolved);
    applyFontSize(fontSize);
    applyBackgroundStyle(readPrefs().backgroundStyle);
  }, [resolved, accentId, fontSize]);

  // React to system theme changes when the user is on "system".
  useEffect(() => {
    if (choice !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      const next = resolve("system");
      setResolved(next);
      applyAccentVars(accentId, next);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [choice, accentId]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    const r = resolve(next);
    setResolved(r);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const setAccentId = useCallback(
    (id: string) => {
      setAccentIdState(id);
      writePrefs({ accentId: id });
      applyAccentVars(id, resolved);
    },
    [resolved],
  );

  const setFontSize = useCallback((size: FontSize) => {
    setFontSizeState(size);
    writePrefs({ fontSize: size });
    applyFontSize(size);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, setChoice, accentId, setAccentId, fontSize, setFontSize }),
    [choice, resolved, setChoice, accentId, setAccentId, fontSize, setFontSize],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
