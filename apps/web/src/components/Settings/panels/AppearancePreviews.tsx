/**
 * Preview cards for the Appearance settings panel.
 *
 * Each card is its own visual demonstration of what selecting that option
 * will do — theme cards render in their own colour palette, font-size
 * cards display "Aa" at that actual scale, accent cards show a sample
 * pill in that colour, and background cards render the real pattern.
 *
 * Kept in a separate file so AppearancePanel.tsx stays focused on
 * orchestration and state wiring.
 */

import clsx from "clsx";

import type { AccentPalette } from "../../../theme/accents";
import type { ResolvedTheme, ThemeChoice } from "../../../theme/ThemeProvider";
import type { BackgroundStyle, FontSize } from "../../../lib/userPreferences";

// ── Theme preview ───────────────────────────────────────────────────
//
// Each card renders a tiny "window" in that mode's actual surface and
// foreground colours. Values are hardcoded so the preview is the same
// regardless of the user's current resolved theme.

interface ThemeColors {
  surface: string;
  fg: string;
  muted: string;
  accent: string;
}

const LIGHT: ThemeColors = {
  surface: "rgb(248 246 241)",
  fg: "rgb(26 20 14)",
  muted: "rgb(138 115 85)",
  accent: "rgb(212 154 71)",
};

const DARK: ThemeColors = {
  surface: "rgb(14 10 6)",
  fg: "rgb(239 234 224)",
  muted: "rgb(168 147 115)",
  accent: "rgb(232 184 115)",
};

function MiniWindow({ colors }: { colors: ThemeColors }) {
  return (
    <div
      className="flex h-full w-full flex-col justify-center gap-1.5 p-2"
      style={{ backgroundColor: colors.surface }}
    >
      <span
        className="h-1 w-3/4 rounded-full"
        style={{ backgroundColor: colors.fg, opacity: 0.85 }}
      />
      <span
        className="h-1 w-1/2 rounded-full"
        style={{ backgroundColor: colors.muted }}
      />
      <span
        className="mt-0.5 h-1.5 w-5 rounded-full"
        style={{ backgroundColor: colors.accent }}
      />
    </div>
  );
}

export function ThemePreviewCard(props: {
  value: ThemeChoice;
  label: string;
  glyph: string;
  active: boolean;
  onClick: () => void;
}) {
  const { value, label, glyph, active, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={clsx(
        "group flex flex-col items-stretch gap-2 rounded-lg border p-1.5 text-left transition-all",
        active
          ? "border-accent shadow-soft ring-2 ring-accent/30"
          : "border-border hover:border-fg-subtle",
      )}
    >
      <div className="h-14 overflow-hidden rounded border border-border">
        {value === "system" ? (
          <div className="flex h-full w-full">
            <div className="flex-1">
              <MiniWindow colors={LIGHT} />
            </div>
            <div className="flex-1 border-l border-border">
              <MiniWindow colors={DARK} />
            </div>
          </div>
        ) : (
          <MiniWindow colors={value === "dark" ? DARK : LIGHT} />
        )}
      </div>
      <div className="flex items-center gap-1.5 px-1 pb-0.5">
        <span aria-hidden className="text-sm leading-none text-fg-muted">
          {glyph}
        </span>
        <span className="text-xs font-medium text-fg">{label}</span>
      </div>
    </button>
  );
}

// ── Accent preview ──────────────────────────────────────────────────
//
// Each card is a self-contained sample of that accent: a coloured "Aa"
// puck on top of a soft accent-tinted background. Clicking applies it
// globally — and because the active card uses border-accent, it will
// instantly snap to its own colour after the click.

export function AccentPreviewCard(props: {
  preset: AccentPalette;
  resolved: ResolvedTheme;
  active: boolean;
  onClick: () => void;
}) {
  const { preset, resolved, active, onClick } = props;
  const c = resolved === "dark" ? preset.dark : preset.light;
  const accent = `rgb(${c.accent})`;
  const accentFg = `rgb(${c.accentFg})`;
  const accentSoft = `rgb(${c.accentSoft})`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={preset.label}
      role="radio"
      aria-checked={active}
      className={clsx(
        "group flex flex-col items-center gap-1.5 rounded-lg border bg-card p-2 transition-all",
        active
          ? "border-fg shadow-soft"
          : "border-border hover:border-fg-subtle",
      )}
    >
      <div
        className="relative flex h-10 w-full items-center justify-center overflow-hidden rounded"
        style={{
          backgroundColor: accentSoft,
          opacity: 0.65,
        }}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold leading-none shadow-soft"
          style={{ backgroundColor: accent, color: accentFg }}
        >
          Aa
        </span>
      </div>
      <span className="text-[11px] font-medium text-fg">{preset.label}</span>
    </button>
  );
}

// ── Font-size preview ───────────────────────────────────────────────
//
// The "Aa" sample and the descriptive label are both rendered at the
// actual scale that option will apply, so the user can see Small text
// is small and Large text is large at a glance.

const SAMPLE_FONT_SIZE: Record<FontSize, string> = {
  sm: "1.5rem",   // ~ scale × 24px
  md: "1.875rem", // ~ scale × 30px
  lg: "2.375rem", // ~ scale × 38px
};

const LABEL_FONT_SIZE: Record<FontSize, string> = {
  sm: "0.75rem",   // 12px
  md: "0.875rem",  // 14px
  lg: "1rem",      // 16px
};

export function FontSizePreviewCard(props: {
  value: FontSize;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const { value, label, active, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={clsx(
        "flex flex-col items-center justify-end gap-1 rounded-lg border px-3 pb-2 pt-3 transition-all",
        active
          ? "border-accent bg-accent/5 ring-2 ring-accent/30"
          : "border-border hover:border-fg-subtle",
      )}
    >
      <span
        className="font-serif font-semibold leading-none text-fg"
        style={{ fontSize: SAMPLE_FONT_SIZE[value] }}
      >
        Aa
      </span>
      <span
        className="font-medium text-fg-muted"
        style={{ fontSize: LABEL_FONT_SIZE[value] }}
      >
        {label}
      </span>
    </button>
  );
}

// ── Background preview ──────────────────────────────────────────────
//
// Mirrors the body[data-bg=…] CSS so each card visually matches the
// background the user will get. Inlined here so we don't have to
// duplicate selectors in index.css.

const PAPER_NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg width='200' height='200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.18'/%3E%3C/svg%3E\")";

function bgPreviewStyle(style: BackgroundStyle): React.CSSProperties {
  const base: React.CSSProperties = {
    backgroundColor: "rgb(var(--c-surface))",
  };
  switch (style) {
    case "gradient":
      return {
        ...base,
        backgroundImage: [
          "radial-gradient(circle at 20% 15%, rgb(var(--c-accent) / 0.45), transparent 65%)",
          "radial-gradient(circle at 85% 100%, rgb(var(--c-fg-muted) / 0.28), transparent 60%)",
        ].join(", "),
      };
    case "flat":
      return base;
    case "paper":
      return {
        ...base,
        backgroundImage: PAPER_NOISE_URL,
        backgroundSize: "100px 100px",
      };
    case "grid":
      return {
        ...base,
        backgroundImage:
          "radial-gradient(circle, rgb(var(--c-fg-subtle) / 0.55) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      };
    default:
      return base;
  }
}

export function BackgroundPreviewCard(props: {
  value: BackgroundStyle;
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  const { value, label, desc, active, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={clsx(
        "flex flex-col gap-2 rounded-lg border p-2 text-left transition-all",
        active
          ? "border-accent bg-accent/5 ring-2 ring-accent/30"
          : "border-border hover:border-fg-subtle",
      )}
    >
      <div
        className="h-14 w-full overflow-hidden rounded border border-border"
        style={bgPreviewStyle(value)}
        aria-hidden
      />
      <div className="px-1 pb-0.5">
        <div className="text-sm font-medium text-fg">{label}</div>
        <div className="text-xs text-fg-subtle">{desc}</div>
      </div>
    </button>
  );
}
