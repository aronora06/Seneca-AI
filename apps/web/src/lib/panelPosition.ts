/** Clamp a panel's top-left corner inside a bounding box. */
export function clampPanelPosition(
  pos: { x: number; y: number },
  panel: { width: number; height: number },
  bounds: { width: number; height: number },
  padding = 8,
): { x: number; y: number } {
  const maxX = Math.max(padding, bounds.width - panel.width - padding);
  const maxY = Math.max(padding, bounds.height - panel.height - padding);
  return {
    x: Math.min(Math.max(padding, pos.x), maxX),
    y: Math.min(Math.max(padding, pos.y), maxY),
  };
}

export function defaultFloatingVoicePosition(
  bounds: { width: number; height: number },
  panel: { width: number; height: number },
  dockSide: "left" | "right",
): { x: number; y: number } {
  const margin = 20;
  const x =
    dockSide === "left"
      ? bounds.width - panel.width - margin
      : margin;
  const y = bounds.height - panel.height - margin;
  return clampPanelPosition({ x, y }, panel, bounds, margin);
}
