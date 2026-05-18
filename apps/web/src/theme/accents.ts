/**
 * Named accent-colour presets. Each provides the three accent CSS vars
 * for both light and dark mode. Applied at runtime via
 * document.documentElement.style — no extra CSS selectors needed.
 */

export interface AccentPalette {
  id: string;
  label: string;
  /** Swatch preview colour (hex). */
  swatch: string;
  light: { accent: string; accentSoft: string; accentFg: string };
  dark:  { accent: string; accentSoft: string; accentFg: string };
}

export const ACCENT_PRESETS: AccentPalette[] = [
  {
    id: "ember",
    label: "Ember",
    swatch: "#d49a47",
    light: { accent: "212 154 71",  accentSoft: "232 184 115", accentFg: "26 20 14" },
    dark:  { accent: "232 184 115", accentSoft: "132 100 64",  accentFg: "14 10 6" },
  },
  {
    id: "sage",
    label: "Sage",
    swatch: "#6b9a6b",
    light: { accent: "107 154 107", accentSoft: "160 200 160", accentFg: "20 40 20" },
    dark:  { accent: "140 190 140", accentSoft: "70 100 70",   accentFg: "10 20 10" },
  },
  {
    id: "ocean",
    label: "Ocean",
    swatch: "#5b8ab5",
    light: { accent: "91 138 181",  accentSoft: "145 185 220", accentFg: "14 30 50" },
    dark:  { accent: "130 175 215", accentSoft: "60 90 120",   accentFg: "10 18 28" },
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "#c47a8a",
    light: { accent: "196 122 138", accentSoft: "225 170 182", accentFg: "50 14 22" },
    dark:  { accent: "215 155 168", accentSoft: "120 65 78",   accentFg: "20 6 10" },
  },
  {
    id: "lavender",
    label: "Lavender",
    swatch: "#9a85b8",
    light: { accent: "154 133 184", accentSoft: "190 175 215", accentFg: "30 20 48" },
    dark:  { accent: "178 160 210", accentSoft: "95 78 120",   accentFg: "14 10 24" },
  },
  {
    id: "slate",
    label: "Slate",
    swatch: "#8a8f96",
    light: { accent: "138 143 150", accentSoft: "185 190 196", accentFg: "20 22 26" },
    dark:  { accent: "170 176 184", accentSoft: "80 85 92",    accentFg: "12 14 16" },
  },
];

export function getAccent(id: string): AccentPalette {
  return ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0]!;
}
