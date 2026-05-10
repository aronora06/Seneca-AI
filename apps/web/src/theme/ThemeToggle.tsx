import clsx from "clsx";
import { useTheme, type ThemeChoice } from "./ThemeProvider";

const OPTIONS: Array<{ value: ThemeChoice; label: string; glyph: string }> = [
  { value: "light", label: "Light", glyph: "☼" },
  { value: "system", label: "System", glyph: "◐" },
  { value: "dark", label: "Dark", glyph: "☾" },
];

export function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-center rounded-full border border-border bg-card/70 p-0.5 text-fg-subtle"
    >
      {OPTIONS.map((opt) => {
        const active = choice === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`Theme: ${opt.label}`}
            onClick={() => setChoice(opt.value)}
            className={clsx(
              "h-6 w-6 rounded-full text-[11px] leading-none transition-colors",
              active
                ? "bg-fg text-fg-on"
                : "hover:text-fg",
            )}
          >
            <span aria-hidden>{opt.glyph}</span>
            <span className="sr-only">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
