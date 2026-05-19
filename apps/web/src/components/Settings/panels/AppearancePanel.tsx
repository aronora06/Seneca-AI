import clsx from "clsx";

import { useTheme, type ThemeChoice } from "../../../theme/ThemeProvider";
import {
  COLOR_PALETTES,
  type PaletteCategory,
} from "../../../theme/palettes";
import {
  usePrefs,
  writePrefs,
  type BackgroundStyle,
  type FontSize,
  type VisionDefault,
} from "../../../lib/userPreferences";
import { useSenecaStore } from "../../../store/seneca";
import { PanelIntro, Section } from "./_shared";
import { PaletteCustomize } from "./PaletteCustomize";
import {
  BackgroundPreviewCard,
  FontSizePreviewCard,
  PalettePreviewCard,
  ThemePreviewCard,
} from "./AppearancePreviews";

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string; glyph: string }> = [
  { value: "light", label: "Light", glyph: "☼" },
  { value: "system", label: "System", glyph: "◐" },
  { value: "dark", label: "Dark", glyph: "☾" },
];

const FONT_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large" },
];

const BG_OPTIONS: Array<{ value: BackgroundStyle; label: string; desc: string }> = [
  { value: "gradient", label: "Gradient", desc: "Subtle warm glow" },
  { value: "flat", label: "Flat", desc: "Solid background" },
  { value: "paper", label: "Paper", desc: "Subtle texture" },
  { value: "grid", label: "Grid", desc: "Dot grid pattern" },
];

const VISION_DEFAULT_OPTIONS: Array<{ value: VisionDefault; label: string }> = [
  { value: "off", label: "Off" },
  { value: "once", label: "Once" },
  { value: "locked", label: "Locked" },
];

const PALETTE_GROUPS: Array<{ category: PaletteCategory; title: string }> = [
  { category: "professional", title: "Professional" },
  { category: "expressive", title: "Expressive" },
];

export function AppearancePanel() {
  const {
    choice,
    setChoice,
    resolved,
    paletteId,
    setPaletteId,
    fontSize,
    setFontSize,
    backgroundStyle,
    setBackgroundStyle,
  } = useTheme();

  const { visionDefault } = usePrefs();
  const applyVisionDefault = useSenecaStore((s) => s.applyVisionDefault);

  const handleVisionDefaultChange = (value: VisionDefault) => {
    writePrefs({ visionDefault: value });
    applyVisionDefault(value);
  };

  return (
    <>
      <PanelIntro
        description="Make Seneca feel like yours. Light and dark set brightness; colour palettes shape the whole interface."
        autoSaves
      />

      <Section label="Brightness" hint="Quick light, dark, or follow your system.">
        <div role="radiogroup" aria-label="Brightness" className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((opt) => (
            <ThemePreviewCard
              key={opt.value}
              value={opt.value}
              label={opt.label}
              glyph={opt.glyph}
              active={choice === opt.value}
              onClick={() => setChoice(opt.value)}
            />
          ))}
        </div>
      </Section>

      {PALETTE_GROUPS.map(({ category, title }) => (
        <Section key={category} label={`${title} palettes`}>
          <div
            role="radiogroup"
            aria-label={`${title} colour palettes`}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {COLOR_PALETTES.filter((p) => p.category === category).map(
              (palette) => (
                <PalettePreviewCard
                  key={palette.id}
                  palette={palette}
                  resolved={resolved}
                  active={paletteId === palette.id}
                  onClick={() => setPaletteId(palette.id)}
                />
              ),
            )}
          </div>
        </Section>
      ))}

      <Section label="Customize">
        <PaletteCustomize />
      </Section>

      <Section label="Font size">
        <div role="radiogroup" aria-label="Font size" className="grid grid-cols-3 gap-2">
          {FONT_OPTIONS.map((opt) => (
            <FontSizePreviewCard
              key={opt.value}
              value={opt.value}
              label={opt.label}
              active={fontSize === opt.value}
              onClick={() => setFontSize(opt.value)}
            />
          ))}
        </div>
      </Section>

      <Section
        label="Background texture"
        hint="Visible behind translucent panels — close settings to preview on the main workspace."
      >
        <div role="radiogroup" aria-label="Background texture" className="grid grid-cols-2 gap-2">
          {BG_OPTIONS.map((opt) => (
            <BackgroundPreviewCard
              key={opt.value}
              value={opt.value}
              label={opt.label}
              desc={opt.desc}
              active={backgroundStyle === opt.value}
              onClick={() => setBackgroundStyle(opt.value)}
            />
          ))}
        </div>
      </Section>

      <Section
        label="Vision default"
        hint="Sets the eye control now and seeds new sessions. You can still change it mid-conversation."
      >
        <div
          role="radiogroup"
          aria-label="Vision default"
          className="flex gap-1 rounded-lg border border-border bg-surface-sunk/50 p-1"
        >
          {VISION_DEFAULT_OPTIONS.map((opt) => {
            const active = visionDefault === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleVisionDefaultChange(opt.value)}
                className={clsx(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-card text-fg shadow-sm"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}
