/**
 * Coerce + apply functions for the `map_*` tools.
 *
 * Each `coerce…` validates raw JSON from Anthropic into a strongly-typed
 * shape, throwing a friendly Error on garbage input. Each `apply…`
 * resolves the live map handle from the bridge and mutates it.
 *
 * Mirrors the whiteboard equivalents — keep this file slim and predictable
 * so the dispatcher reads as a flat switch.
 */

import type {
  MapDrawShapeInput,
  MapDropPinInput,
  MapFlyToInput,
  MapSetLayerInput,
  MapShapeKind,
} from "@seneca/shared";

import { getMapApi } from "./mapBridge";

const requireMapApi = () => {
  const api = getMapApi();
  if (!api) throw new Error("Map is not mounted yet.");
  return api;
};

// ── coercers ────────────────────────────────────────────────────────────────

export function coerceFlyToInput(raw: unknown): MapFlyToInput {
  const obj = requireObject(raw);
  const lat = requireFiniteNumber(obj.lat, "lat");
  const lng = requireFiniteNumber(obj.lng, "lng");
  assertLatLng(lat, lng);
  const out: MapFlyToInput = { lat, lng };
  if (typeof obj.zoom === "number" && Number.isFinite(obj.zoom)) {
    out.zoom = clampZoom(obj.zoom);
  }
  if (typeof obj.label === "string" && obj.label.trim()) {
    out.label = obj.label.trim();
  }
  return out;
}

export function coerceDropPinInput(raw: unknown): MapDropPinInput {
  const obj = requireObject(raw);
  const lat = requireFiniteNumber(obj.lat, "lat");
  const lng = requireFiniteNumber(obj.lng, "lng");
  assertLatLng(lat, lng);
  if (typeof obj.label !== "string" || !obj.label.trim()) {
    throw new Error("map_drop_pin requires a non-empty `label`.");
  }
  return { lat, lng, label: obj.label.trim() };
}

export function coerceDrawShapeInput(raw: unknown): MapDrawShapeInput {
  const obj = requireObject(raw);
  const kind = obj.type;
  if (kind !== "polyline" && kind !== "polygon") {
    throw new Error(`Unsupported map shape: ${String(kind)}`);
  }
  if (!Array.isArray(obj.points)) {
    throw new Error("`points` must be an array of [lat, lng] pairs.");
  }
  const points: [number, number][] = obj.points
    .filter(
      (p): p is [number, number] =>
        Array.isArray(p) &&
        p.length === 2 &&
        Number.isFinite(p[0]) &&
        Number.isFinite(p[1]),
    )
    .map(([lat, lng]) => {
      assertLatLng(lat, lng);
      return [lat, lng] as [number, number];
    });
  const minPoints = kind === "polygon" ? 3 : 2;
  if (points.length < minPoints) {
    throw new Error(
      `${kind} needs at least ${minPoints} valid [lat, lng] points.`,
    );
  }
  const out: MapDrawShapeInput = { type: kind as MapShapeKind, points };
  if (typeof obj.label === "string" && obj.label.trim()) {
    out.label = obj.label.trim();
  }
  if (typeof obj.color === "string" && obj.color.trim()) {
    out.color = obj.color.trim();
  }
  return out;
}

export function coerceSetLayerInput(raw: unknown): MapSetLayerInput {
  const obj = requireObject(raw);
  if (obj.layer !== "standard" && obj.layer !== "satellite") {
    throw new Error(`Unsupported layer: ${String(obj.layer)}`);
  }
  return { layer: obj.layer };
}

// ── apply functions ─────────────────────────────────────────────────────────

export function applyMapFlyTo(input: MapFlyToInput): void {
  const api = requireMapApi();
  api.flyTo(input.lat, input.lng, input.zoom);
  if (input.label) {
    api.addPin({ lat: input.lat, lng: input.lng, label: input.label });
  }
}

export function applyMapDropPin(input: MapDropPinInput): void {
  const api = requireMapApi();
  api.addPin({ lat: input.lat, lng: input.lng, label: input.label });
}

export function applyMapDrawShape(input: MapDrawShapeInput): void {
  const api = requireMapApi();
  api.addShape({
    type: input.type,
    points: input.points,
    label: input.label,
    color: input.color,
  });
}

export function applyMapSetLayer(input: MapSetLayerInput): void {
  const api = requireMapApi();
  api.setLayer(input.layer);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function requireObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new Error("Tool input was not an object.");
  }
  return raw as Record<string, unknown>;
}

function requireFiniteNumber(v: unknown, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`\`${name}\` must be a finite number.`);
  }
  return n;
}

function assertLatLng(lat: number, lng: number): void {
  if (lat < -90 || lat > 90) {
    throw new Error(`Latitude out of range: ${lat}`);
  }
  if (lng < -180 || lng > 180) {
    throw new Error(`Longitude out of range: ${lng}`);
  }
}

function clampZoom(z: number): number {
  if (z < 0) return 0;
  if (z > 19) return 19;
  return z;
}
