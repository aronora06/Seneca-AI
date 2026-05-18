import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULTS,
  readPrefs,
  writePrefs,
  type VisionDefault,
} from "./userPreferences";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore — test setup stubs localStorage if happy-dom is missing it.
  }
});

describe("userPreferences — visionDefault", () => {
  it("defaults to 'off' when no preferences exist", () => {
    expect(readPrefs().visionDefault).toBe("off");
  });

  it("round-trips each valid VisionDefault through writePrefs", () => {
    const values: VisionDefault[] = ["off", "once", "locked"];
    for (const v of values) {
      writePrefs({ visionDefault: v });
      expect(readPrefs().visionDefault).toBe(v);
    }
  });

  it("falls back to the documented default when stored value is garbage", () => {
    try {
      localStorage.setItem(
        "seneca:prefs",
        JSON.stringify({ visionDefault: "sometimes" }),
      );
    } catch {
      // ignore
    }
    expect(readPrefs().visionDefault).toBe(DEFAULTS.visionDefault);
  });

  it("preserves other prefs when only visionDefault is updated", () => {
    writePrefs({ displayName: "Aurelius", accentId: "ember" });
    writePrefs({ visionDefault: "locked" });
    const next = readPrefs();
    expect(next.visionDefault).toBe("locked");
    expect(next.displayName).toBe("Aurelius");
    expect(next.accentId).toBe("ember");
  });
});
