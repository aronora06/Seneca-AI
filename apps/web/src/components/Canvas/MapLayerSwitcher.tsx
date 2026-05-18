/**
 * Compact two-button toggle that floats over the map's top-right corner.
 * Lets the user flip between standard and satellite tiles without going
 * through the AI.
 */

import clsx from "clsx";

import type { MapLayer } from "@seneca/shared";

interface MapLayerSwitcherProps {
  active: MapLayer;
  onChange: (layer: MapLayer) => void;
}

const OPTIONS: Array<{ id: MapLayer; label: string }> = [
  { id: "standard", label: "Standard" },
  { id: "satellite", label: "Satellite" },
];

export function MapLayerSwitcher({ active, onChange }: MapLayerSwitcherProps) {
  return (
    <div
      className="card pointer-events-auto absolute right-3 top-3 flex overflow-hidden p-0 text-xs shadow-md"
      style={{ zIndex: 1000 }}
      role="group"
      aria-label="Map layer"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          aria-pressed={active === opt.id}
          onClick={() => active !== opt.id && onChange(opt.id)}
          className={clsx(
            "h-8 px-3 font-medium transition-colors",
            active === opt.id
              ? "bg-fg text-fg-on"
              : "bg-card text-fg-muted hover:bg-surface-sunk hover:text-fg",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
