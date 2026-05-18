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

describe("userPreferences — Phase B voice fields", () => {
  it("defaults editBeforeSend to true, vadEnabled to true, pttKey to Space", () => {
    const p = readPrefs();
    expect(p.editBeforeSend).toBe(true);
    expect(p.vadEnabled).toBe(true);
    expect(p.pttKey).toBe(" ");
  });

  it("round-trips boolean editBeforeSend and vadEnabled, and string pttKey", () => {
    writePrefs({ editBeforeSend: false, vadEnabled: false, pttKey: "Tab" });
    const p = readPrefs();
    expect(p.editBeforeSend).toBe(false);
    expect(p.vadEnabled).toBe(false);
    expect(p.pttKey).toBe("Tab");
  });

  it("rejects non-boolean editBeforeSend and non-string pttKey on read", () => {
    try {
      localStorage.setItem(
        "seneca:prefs",
        JSON.stringify({
          editBeforeSend: "yes",
          vadEnabled: 1,
          pttKey: "",
        }),
      );
    } catch {
      // ignore
    }
    const p = readPrefs();
    expect(p.editBeforeSend).toBe(true);
    expect(p.vadEnabled).toBe(true);
    expect(p.pttKey).toBe(" ");
  });
});
