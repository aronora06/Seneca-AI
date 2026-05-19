import { describe, expect, it } from "vitest";

import {
  clampPanelPosition,
  defaultFloatingVoicePosition,
} from "./panelPosition";

describe("panelPosition", () => {
  it("clamps inside bounds with padding", () => {
    expect(
      clampPanelPosition(
        { x: 999, y: -10 },
        { width: 100, height: 40 },
        { width: 300, height: 200 },
        8,
      ),
    ).toEqual({ x: 192, y: 8 });
  });

  it("places default near bottom opposite the docked voice pane", () => {
    const leftDocked = defaultFloatingVoicePosition(
      { width: 800, height: 600 },
      { width: 280, height: 44 },
      "left",
    );
    expect(leftDocked.x).toBeGreaterThan(400);

    const rightDocked = defaultFloatingVoicePosition(
      { width: 800, height: 600 },
      { width: 280, height: 44 },
      "right",
    );
    expect(rightDocked.x).toBeLessThan(100);
  });
});
