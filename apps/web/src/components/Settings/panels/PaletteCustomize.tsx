import { useCallback, useMemo } from "react";
import clsx from "clsx";

import { useTheme } from "../../../theme/ThemeProvider";
import { getPalette, resolvePaletteTokens } from "../../../theme/palettes";
import {
  hexToRgbTriple,
  rgbTripleToHex,
  type SemanticTokens,
  type TokenKey,
} from "../../../theme/tokens";
import { contrastRatio } from "../../../theme/contrast";
import { GhostLink } from "./_shared";

const FINE_TUNE_KEYS: Array<{ key: TokenKey; label: string; hint?: string }> = [
  { key: "surface", label: "Background" },
  { key: "fg", label: "Text" },
  { key: "accent", label: "Accent", hint: "Highlights & focus rings" },
  { key: "card", label: "Cards", hint: "Panels & inputs" },
  { key: "border", label: "Borders" },
];

export function PaletteCustomize() {
  const { resolved, paletteId, paletteOverrides, setPaletteOverrides } =
    useTheme();

  const effective = useMemo(
    () => resolvePaletteTokens(paletteId, resolved, paletteOverrides),
    [paletteId, resolved, paletteOverrides],
  );

  const hasOverrides =
    paletteOverrides !== null && Object.keys(paletteOverrides).length > 0;

  const handleColorChange = useCallback(
    (key: TokenKey, hex: string) => {
      const triple = hexToRgbTriple(hex);
      if (!triple) return;
      const next: Partial<SemanticTokens> = {
        ...(paletteOverrides ?? {}),
        [key]: triple,
      };
      setPaletteOverrides(next);
    },
    [paletteOverrides, setPaletteOverrides],
  );

  const resetOverrides = useCallback(() => {
    setPaletteOverrides(null);
  }, [setPaletteOverrides]);

  const usePresetAsBase = useCallback(() => {
    setPaletteOverrides(null);
  }, [setPaletteOverrides]);

  const fgContrast = contrastRatio(effective.fg, effective.surface);
  const contrastOk = fgContrast >= 4.5;

  return (
    <div className="rounded-lg border border-border bg-surface-sunk/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-fg">Fine-tune colours</h4>
          <p className="mt-0.5 text-xs text-fg-subtle">
            Start from{" "}
            <span className="font-medium text-fg-muted">
              {getPalette(paletteId).label}
            </span>
            , then adjust any swatch. Changes apply instantly.
          </p>
        </div>
        {hasOverrides && (
          <GhostLink onClick={resetOverrides}>Reset custom colours</GhostLink>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FINE_TUNE_KEYS.map(({ key, label, hint }) => {
          const value = effective[key];
          const isOverridden = paletteOverrides?.[key] !== undefined;
          return (
            <label
              key={key}
              className={clsx(
                "flex items-center gap-3 rounded-md border px-3 py-2",
                isOverridden
                  ? "border-accent/50 bg-card"
                  : "border-border bg-card/60",
              )}
            >
              <input
                type="color"
                value={rgbTripleToHex(value)}
                onChange={(e) => handleColorChange(key, e.target.value)}
                className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
                aria-label={`${label} colour`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{label}</span>
                {hint && (
                  <span className="block text-[11px] text-fg-subtle">{hint}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      <div
        className={clsx(
          "mt-3 rounded-md px-3 py-2 text-xs",
          contrastOk
            ? "bg-ok-soft text-ok"
            : "bg-danger-soft text-danger-fg",
        )}
        role="status"
      >
        {contrastOk ? (
          <>
            Text contrast looks good ({fgContrast.toFixed(1)}:1 on background).
          </>
        ) : (
          <>
            Text contrast is low ({fgContrast.toFixed(1)}:1). Aim for at least
            4.5:1 for comfortable reading.
          </>
        )}
      </div>

      {hasOverrides && (
        <p className="mt-2 text-[11px] text-fg-subtle">
          <button
            type="button"
            className="text-accent underline-offset-2 hover:underline"
            onClick={usePresetAsBase}
          >
            Revert to {getPalette(paletteId).label} defaults
          </button>
        </p>
      )}
    </div>
  );
}
