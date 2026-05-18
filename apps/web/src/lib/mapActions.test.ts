import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the bridge so applyXxx doesn't need a real Leaflet map mounted.
const mapApi = {
  flyTo: vi.fn(),
  addPin: vi.fn(),
  addShape: vi.fn(),
  setLayer: vi.fn(),
};
vi.mock("./mapBridge", () => ({
  getMapApi: () => mapApi,
}));

import {
  applyMapDrawShape,
  applyMapDropPin,
  applyMapFlyTo,
  applyMapSetLayer,
  coerceDrawShapeInput,
  coerceDropPinInput,
  coerceFlyToInput,
  coerceSetLayerInput,
} from "./mapActions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("coerceFlyToInput", () => {
  it("accepts valid lat/lng/zoom/label", () => {
    expect(
      coerceFlyToInput({ lat: 41.9, lng: 12.5, zoom: 10, label: "Rome" }),
    ).toEqual({ lat: 41.9, lng: 12.5, zoom: 10, label: "Rome" });
  });

  it("strips label whitespace and omits empty label", () => {
    const out = coerceFlyToInput({ lat: 0, lng: 0, label: "   " });
    expect(out.label).toBeUndefined();
  });

  it("clamps zoom to [0, 19]", () => {
    expect(coerceFlyToInput({ lat: 0, lng: 0, zoom: 999 }).zoom).toBe(19);
    expect(coerceFlyToInput({ lat: 0, lng: 0, zoom: -5 }).zoom).toBe(0);
  });

  it("rejects out-of-range coordinates", () => {
    expect(() => coerceFlyToInput({ lat: 200, lng: 0 })).toThrow(/Latitude/);
    expect(() => coerceFlyToInput({ lat: 0, lng: -300 })).toThrow(/Longitude/);
  });

  it("rejects non-finite numbers", () => {
    expect(() => coerceFlyToInput({ lat: Number.NaN, lng: 0 })).toThrow();
    expect(() => coerceFlyToInput({ lat: "abc", lng: 0 })).toThrow();
  });
});

describe("coerceDropPinInput", () => {
  it("requires a non-empty label", () => {
    expect(() => coerceDropPinInput({ lat: 0, lng: 0 })).toThrow();
    expect(() => coerceDropPinInput({ lat: 0, lng: 0, label: "" })).toThrow();
    expect(() => coerceDropPinInput({ lat: 0, lng: 0, label: "   " })).toThrow();
  });

  it("accepts and trims the label", () => {
    expect(
      coerceDropPinInput({ lat: 0, lng: 0, label: "  Origin  " }),
    ).toEqual({ lat: 0, lng: 0, label: "Origin" });
  });
});

describe("coerceDrawShapeInput", () => {
  it("rejects unsupported shape types", () => {
    expect(() =>
      coerceDrawShapeInput({ type: "blob", points: [] }),
    ).toThrow();
  });

  it("requires at least 2 points for polyline, 3 for polygon", () => {
    expect(() =>
      coerceDrawShapeInput({ type: "polyline", points: [[0, 0]] }),
    ).toThrow();
    expect(() =>
      coerceDrawShapeInput({
        type: "polygon",
        points: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toThrow();
  });

  it("accepts a valid polyline with optional label/color", () => {
    const out = coerceDrawShapeInput({
      type: "polyline",
      points: [
        [10, 20],
        [30, 40],
      ],
      label: "route",
      color: "#c00",
    });
    expect(out.type).toBe("polyline");
    expect(out.points).toHaveLength(2);
    expect(out.label).toBe("route");
    expect(out.color).toBe("#c00");
  });

  it("validates each [lat, lng] pair", () => {
    expect(() =>
      coerceDrawShapeInput({
        type: "polyline",
        points: [
          [200, 0],
          [0, 0],
        ],
      }),
    ).toThrow();
  });
});

describe("coerceSetLayerInput", () => {
  it("accepts standard / satellite", () => {
    expect(coerceSetLayerInput({ layer: "standard" })).toEqual({
      layer: "standard",
    });
    expect(coerceSetLayerInput({ layer: "satellite" })).toEqual({
      layer: "satellite",
    });
  });

  it("rejects anything else", () => {
    expect(() => coerceSetLayerInput({ layer: "topo" })).toThrow();
  });
});

describe("apply functions thread to the bridge", () => {
  it("applyMapFlyTo calls flyTo and optionally addPin", () => {
    applyMapFlyTo({ lat: 1, lng: 2 });
    expect(mapApi.flyTo).toHaveBeenCalledWith(1, 2, undefined);
    expect(mapApi.addPin).not.toHaveBeenCalled();

    applyMapFlyTo({ lat: 3, lng: 4, zoom: 7, label: "X" });
    expect(mapApi.flyTo).toHaveBeenLastCalledWith(3, 4, 7);
    expect(mapApi.addPin).toHaveBeenCalledWith({ lat: 3, lng: 4, label: "X" });
  });

  it("applyMapDropPin / applyMapDrawShape / applyMapSetLayer thread through", () => {
    applyMapDropPin({ lat: 5, lng: 6, label: "L" });
    expect(mapApi.addPin).toHaveBeenCalledWith({ lat: 5, lng: 6, label: "L" });

    applyMapDrawShape({
      type: "polygon",
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    expect(mapApi.addShape).toHaveBeenCalled();

    applyMapSetLayer({ layer: "satellite" });
    expect(mapApi.setLayer).toHaveBeenCalledWith("satellite");
  });
});
