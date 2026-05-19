/**
 * Semantic colour tokens — space-separated RGB triples for Tailwind
 * `rgb(var(--c-*) / <alpha>)` usage.
 */

export interface SemanticTokens {
  surface: string;
  surfaceSunk: string;
  card: string;
  border: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  fgOn: string;
  accent: string;
  accentSoft: string;
  accentFg: string;
  danger: string;
  dangerSoft: string;
  dangerFg: string;
  ok: string;
  okSoft: string;
}

export type TokenKey = keyof SemanticTokens;

const TOKEN_CSS_VAR: Record<TokenKey, string> = {
  surface: "--c-surface",
  surfaceSunk: "--c-surface-sunk",
  card: "--c-card",
  border: "--c-border",
  fg: "--c-fg",
  fgMuted: "--c-fg-muted",
  fgSubtle: "--c-fg-subtle",
  fgOn: "--c-fg-on",
  accent: "--c-accent",
  accentSoft: "--c-accent-soft",
  accentFg: "--c-accent-fg",
  danger: "--c-danger",
  dangerSoft: "--c-danger-soft",
  dangerFg: "--c-danger-fg",
  ok: "--c-ok",
  okSoft: "--c-ok-soft",
};

export function applySemanticTokens(tokens: SemanticTokens): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  for (const key of Object.keys(TOKEN_CSS_VAR) as TokenKey[]) {
    root.setProperty(TOKEN_CSS_VAR[key], tokens[key]);
  }
}

export function clearSemanticTokenOverrides(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  for (const varName of Object.values(TOKEN_CSS_VAR)) {
    root.removeProperty(varName);
  }
}

export function mergeTokens(
  base: SemanticTokens,
  overrides: Partial<SemanticTokens> | null | undefined,
): SemanticTokens {
  if (!overrides) return { ...base };
  return { ...base, ...overrides };
}

/** Parse `#rrggbb` or `rrggbb` into an RGB triple string. */
export function hexToRgbTriple(hex: string): string | null {
  const raw = hex.replace(/^#/, "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** Format an RGB triple as `#rrggbb` for color inputs. */
export function rgbTripleToHex(triple: string): string {
  const parts = triple.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "#000000";
  return (
    "#" +
    parts
      .map((n) => Math.max(0, Math.min(255, Math.round(n))))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
  );
}
