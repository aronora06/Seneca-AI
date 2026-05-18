import { useState } from "react";
import clsx from "clsx";

import { useTheme, type ThemeChoice } from "../../../theme/ThemeProvider";
import { ACCENT_PRESETS } from "../../../theme/accents";
import {
  readPrefs,
  writePrefs,
  type BackgroundStyle,
  type FontSize,
  type VisionDefault,
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

const VISION_DEFAULT_OPTIONS: Array<{ value: VisionDefault; label: string }> = [
  { value: "off",    label: "Off"     },
  { value: "once",   label: "Once"    },
  { value: "locked", label: "Locked"  },
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
  const [visionDefault, setVisionDefault] = useState<VisionDefault>(
    () => readPrefs().visionDefault,
  );

  const handleBgChange = (style: BackgroundStyle) => {
    setBgStyle(style);
    writePrefs({ backgroundStyle: style });
    if (style === "gradient") document.body.removeAttribute("data-bg");
    else document.body.setAttribute("data-bg", style);
  };

  const handleVisionDefaultChange = (value: VisionDefault) => {
    setVisionDefault(value);
    writePrefs({ visionDefault: value });
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

      <Section
        label="Vision default"
        hint="Where the eye-icon segmented control starts when you open a new session. You can still change it mid-conversation."
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
