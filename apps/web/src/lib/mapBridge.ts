/**
 * Imperative handle for the live Leaflet map.
 *
 * The MapTab component owns the Leaflet instance; this bridge lets the
 * action dispatcher call into it without importing Leaflet (and without
 * subscribing to the Zustand store, which would re-trigger renders).
 *
 * Mirrors the role `whiteboardBridge` plays for Excalidraw.
 */

import type { MapLayer, MapPin, MapShape } from "@seneca/shared";

export interface MapApi {
  /** Animate the camera to (lat, lng) at the given zoom (defaults to current). */
  flyTo(lat: number, lng: number, zoom?: number): void;
  /** Add a pin to the live map and return the assigned id. */
  addPin(pin: Omit<MapPin, "id">): string;
  /** Add a polyline / polygon overlay and return the assigned id. */
  addShape(shape: Omit<MapShape, "id">): string;
  /** Switch the active tile layer. */
  setLayer(layer: MapLayer): void;
}

let api: MapApi | null = null;

export function setMapApi(next: MapApi | null): void {
  api = next;
}

export function getMapApi(): MapApi | null {
  return api;
}
