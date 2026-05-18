import { useState } from "react";

import { useTheme, type ThemeChoice } from "../../../theme/ThemeProvider";
import { ACCENT_PRESETS } from "../../../theme/accents";
import {
  readPrefs,
  writePrefs,
  type BackgroundStyle,
  type FontSize,
} from "../../../lib/userPreferences";
import { PanelIntro, Section } from "./_shared";
import {
  AccentPreviewCard,
  BackgroundPreviewCard,
  FontSizePreviewCard,
  ThemePreviewCard,
} from "./AppearancePreviews";

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string; glyph: string }> = [
  { value: "light",  label: "Light",  glyph: "☼" },
  { value: "system", label: "System", glyph: "◐" },
  { value: "dark",   label: "Dark",   glyph: "☾" },
];

const FONT_OPTIONS: Array<{ value: FontSize; label: string }> = [
  { value: "sm", label: "Small"   },
  { value: "md", label: "Default" },
  { value: "lg", label: "Large"   },
];

const BG_OPTIONS: Array<{ value: BackgroundStyle; label: string; desc: string }> = [
  { value: "gradient", label: "Gradient", desc: "Subtle warm glow" },
  { value: "flat",     label: "Flat",     desc: "Solid background" },
  { value: "paper",    label: "Paper",    desc: "Subtle texture"   },
  { value: "grid",     label: "Grid",     desc: "Dot grid pattern" },
];

export function AppearancePanel() {
  const {
    choice,
    setChoice,
    resolved,
    accentId,
    setAccentId,
    fontSize,
    setFontSize,
  } = useTheme();
  const [bgStyle, setBgStyle] = useState<BackgroundStyle>(
    () => readPrefs().backgroundStyle,
  );

  const handleBgChange = (style: BackgroundStyle) => {
    setBgStyle(style);
    writePrefs({ backgroundStyle: style });
    if (style === "gradient") document.body.removeAttribute("data-bg");
    else document.body.setAttribute("data-bg", style);
  };

  return (
    <>
      <PanelIntro
        description="Make Seneca feel like yours. Each option below is a live preview of the change."
        autoSaves
      />

      <Section label="Theme">
        <div role="radiogroup" className="grid grid-cols-3 gap-2">
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

      <Section
        label="Accent colour"
        hint="Used for highlights, focus rings, and primary actions."
      >
        <div role="radiogroup" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ACCENT_PRESETS.map((preset) => (
            <AccentPreviewCard
              key={preset.id}
              preset={preset}
              resolved={resolved}
              active={accentId === preset.id}
              onClick={() => setAccentId(preset.id)}
            />
          ))}
        </div>
      </Section>

      <Section label="Font size">
        <div role="radiogroup" className="grid grid-cols-3 gap-2">
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

      <Section label="Background">
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {BG_OPTIONS.map((opt) => (
            <BackgroundPreviewCard
              key={opt.value}
              value={opt.value}
              label={opt.label}
              desc={opt.desc}
              active={bgStyle === opt.value}
              onClick={() => handleBgChange(opt.value)}
            />
          ))}
        </div>
      </Section>
    </>
  );
}
