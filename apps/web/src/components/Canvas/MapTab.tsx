/**
 * Live world map. Owns a single Leaflet instance and exposes an imperative
 * MapApi via the bridge so the action dispatcher can fly to coordinates,
 * drop pins, draw shapes, and switch tile layers.
 *
 * Mirrors WhiteboardTab in shape:
 *   - snapshot the store ONCE on mount; never subscribe (no React/Leaflet
 *     update loop).
 *   - register a capturer for the vision pipeline.
 *   - debounce-persist the live state via PUT.
 *
 * Why pure imperative (no react-leaflet)? Pins / shapes / camera are all
 * driven by streaming tool calls, not declarative React props — the
 * imperative API matches the data flow and keeps re-renders to zero.
 */

import L, { type FeatureGroup, type Map as LeafletMap, type TileLayer } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import * as htmlToImage from "html-to-image";
import { useEffect, useRef, useState } from "react";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png?url";
import markerIcon from "leaflet/dist/images/marker-icon.png?url";
import markerShadow from "leaflet/dist/images/marker-shadow.png?url";

import type { MapLayer, MapPin, MapShape, MapState } from "@seneca/shared";

import { useSenecaStore } from "../../store/seneca";
import { getMapApi, setMapApi, type MapApi } from "../../lib/mapBridge";
import { registerCapturer } from "../../lib/captureCanvas";
import { apiJson } from "../../lib/api";
import { MapLayerSwitcher } from "./MapLayerSwitcher";

// Vite + Leaflet default-icon workaround: the bundled URL helpers don't
// know about Vite's asset pipeline, so we override them once with the
// resolved asset URLs that Vite hands us.
type IconDefaultProto = L.Icon.Default & {
  _getIconUrl?: () => string;
};
delete (L.Icon.Default.prototype as IconDefaultProto)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const DEBOUNCE_MS = 600;
const DEFAULT_SHAPE_COLOR = "#c92a2a";

const TILE_PROVIDERS: Record<
  MapLayer,
  { url: string; attribution: string; maxZoom: number }
> = {
  standard: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    maxZoom: 19,
  },
};

export function MapTab() {
  const sessionId = useSenecaStore((s) => s.session.id);
  const setMap = useSenecaStore((s) => s.setMap);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const tileLayerRef = useRef<TileLayer | null>(null);
  const featureGroupRef = useRef<FeatureGroup | null>(null);
  const stateRef = useRef<MapState | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastSavedJson = useRef<string>("");
  const [activeLayer, setActiveLayer] = useState<MapLayer>(
    () =>
      useSenecaStore.getState().mapState?.layer ?? "standard",
  );

  // ── one-shot map bootstrap ───────────────────────────────────────────────

  useEffect(() => {
    const host = containerRef.current;
    if (!host || mapRef.current) return;

    const initial = useSenecaStore.getState().mapState;
    const center = initial?.center ?? [20, 0];
    const zoom = initial?.zoom ?? 2;
    const layer = initial?.layer ?? "standard";

    const map = L.map(host, {
      center,
      zoom,
      worldCopyJump: true,
      zoomControl: true,
    });
    mapRef.current = map;

    const tile = makeTileLayer(layer);
    tile.addTo(map);
    tileLayerRef.current = tile;

    const featureGroup = new L.FeatureGroup();
    featureGroup.addTo(map);
    featureGroupRef.current = featureGroup;

    // Wire the leaflet-draw toolbar (top-left below the zoom controls).
    const drawControl = new L.Control.Draw({
      position: "topleft",
      edit: { featureGroup, remove: true },
      draw: {
        marker: { icon: new L.Icon.Default() },
        polyline: { shapeOptions: { color: DEFAULT_SHAPE_COLOR } },
        polygon: {
          allowIntersection: false,
          showArea: false,
          shapeOptions: { color: DEFAULT_SHAPE_COLOR },
        },
        rectangle: { shapeOptions: { color: DEFAULT_SHAPE_COLOR } },
        circle: false,
        circlemarker: false,
      },
    });
    map.addControl(drawControl);

    // User-drawn features get appended to the same feature group AI uses.
    map.on(L.Draw.Event.CREATED, (e: unknown) => {
      const ev = e as { layer: L.Layer; layerType: string };
      featureGroup.addLayer(ev.layer);
      mirrorUserDraw(ev);
      schedulePersist();
    });

    map.on("draw:edited draw:deleted", () => {
      // After edits/deletes, walk the feature group and re-derive state.
      reSyncFromFeatureGroup();
      schedulePersist();
    });

    // Hydrate pins + shapes from the snapshot.
    if (initial) {
      stateRef.current = { ...initial };
      hydratePins(initial.pins);
      hydrateShapes(initial.shapes);
    } else {
      stateRef.current = {
        center,
        zoom,
        layer,
        pins: [],
        shapes: [],
      };
    }

    // Push back to store on user-driven camera changes.
    map.on("moveend zoomend", () => {
      if (!stateRef.current) return;
      const c = map.getCenter();
      stateRef.current = {
        ...stateRef.current,
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
      };
      schedulePersist();
    });

    // Force Leaflet to size correctly on first paint (the parent layout
    // resolves after this effect mounts).
    requestAnimationFrame(() => {
      map.invalidateSize();
    });

    // Expose the imperative API so the dispatcher can act on the map.
    const api: MapApi = {
      flyTo: (lat, lng, zoom) => {
        map.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 0.8 });
      },
      addPin: (pin) => {
        const id = crypto.randomUUID();
        const marker = L.marker([pin.lat, pin.lng]);
        if (pin.label) {
          marker.bindTooltip(pin.label, { permanent: true, direction: "top" });
        }
        marker.addTo(featureGroup);
        if (stateRef.current) {
          stateRef.current = {
            ...stateRef.current,
            pins: [...stateRef.current.pins, { id, ...pin }],
          };
          mirrorToStore();
          schedulePersist();
        }
        return id;
      },
      addShape: (shape) => {
        const id = crypto.randomUUID();
        const layer = makeShapeLayer({ id, ...shape });
        layer.addTo(featureGroup);
        if (stateRef.current) {
          stateRef.current = {
            ...stateRef.current,
            shapes: [...stateRef.current.shapes, { id, ...shape }],
          };
          mirrorToStore();
          schedulePersist();
        }
        return id;
      },
      setLayer: (next) => {
        switchTileLayer(next);
      },
    };
    setMapApi(api);

    return () => {
      setMapApi(null);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      featureGroupRef.current = null;
    };

    // ── inner helpers (closures over refs) ─────────────────────────────────

    function makeTileLayer(layer: MapLayer): TileLayer {
      const cfg = TILE_PROVIDERS[layer];
      return L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: cfg.maxZoom,
        crossOrigin: true,
      });
    }

    function switchTileLayer(next: MapLayer): void {
      if (next === stateRef.current?.layer) return;
      const m = mapRef.current;
      if (!m) return;
      const old = tileLayerRef.current;
      const fresh = makeTileLayer(next);
      fresh.addTo(m);
      if (old) m.removeLayer(old);
      tileLayerRef.current = fresh;
      setActiveLayer(next);
      if (stateRef.current) {
        stateRef.current = { ...stateRef.current, layer: next };
        mirrorToStore();
        schedulePersist();
      }
    }

    function makeShapeLayer(shape: MapShape): L.Layer {
      const color = shape.color ?? DEFAULT_SHAPE_COLOR;
      const latlngs = shape.points.map(([lat, lng]) =>
        L.latLng(lat, lng),
      );
      const layer =
        shape.type === "polygon"
          ? L.polygon(latlngs, { color, weight: 3, fillOpacity: 0.15 })
          : L.polyline(latlngs, { color, weight: 3 });
      if (shape.label) {
        layer.bindTooltip(shape.label, { sticky: true });
      }
      return layer;
    }

    function hydratePins(pins: MapPin[]): void {
      const fg = featureGroupRef.current;
      if (!fg) return;
      for (const pin of pins) {
        const marker = L.marker([pin.lat, pin.lng]);
        if (pin.label) {
          marker.bindTooltip(pin.label, {
            permanent: true,
            direction: "top",
          });
        }
        marker.addTo(fg);
      }
    }

    function hydrateShapes(shapes: MapShape[]): void {
      const fg = featureGroupRef.current;
      if (!fg) return;
      for (const shape of shapes) {
        makeShapeLayer(shape).addTo(fg);
      }
    }

    function mirrorUserDraw(ev: { layer: L.Layer; layerType: string }): void {
      if (!stateRef.current) return;
      if (ev.layerType === "marker") {
        const marker = ev.layer as L.Marker;
        const ll = marker.getLatLng();
        stateRef.current = {
          ...stateRef.current,
          pins: [
            ...stateRef.current.pins,
            { id: crypto.randomUUID(), lat: ll.lat, lng: ll.lng },
          ],
        };
      } else if (
        ev.layerType === "polyline" ||
        ev.layerType === "polygon" ||
        ev.layerType === "rectangle"
      ) {
        const path = ev.layer as L.Polyline;
        const raw = path.getLatLngs();
        const flat = flattenLatLngs(raw);
        const points = flat.map(
          (ll) => [ll.lat, ll.lng] as [number, number],
        );
        const kind: "polyline" | "polygon" =
          ev.layerType === "polyline" ? "polyline" : "polygon";
        stateRef.current = {
          ...stateRef.current,
          shapes: [
            ...stateRef.current.shapes,
            { id: crypto.randomUUID(), type: kind, points },
          ],
        };
      }
      mirrorToStore();
    }

    function reSyncFromFeatureGroup(): void {
      const fg = featureGroupRef.current;
      if (!fg || !stateRef.current) return;
      const pins: MapPin[] = [];
      const shapes: MapShape[] = [];
      fg.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
          const ll = layer.getLatLng();
          const tip = layer.getTooltip()?.getContent();
          pins.push({
            id: crypto.randomUUID(),
            lat: ll.lat,
            lng: ll.lng,
            label: typeof tip === "string" ? tip : undefined,
          });
        } else if (layer instanceof L.Polygon) {
          const flat = flattenLatLngs(layer.getLatLngs());
          shapes.push({
            id: crypto.randomUUID(),
            type: "polygon",
            points: flat.map((ll) => [ll.lat, ll.lng]),
          });
        } else if (layer instanceof L.Polyline) {
          const flat = flattenLatLngs(layer.getLatLngs());
          shapes.push({
            id: crypto.randomUUID(),
            type: "polyline",
            points: flat.map((ll) => [ll.lat, ll.lng]),
          });
        }
      });
      stateRef.current = { ...stateRef.current, pins, shapes };
      mirrorToStore();
    }

    function mirrorToStore(): void {
      if (!stateRef.current) return;
      setMap(stateRef.current);
    }

    function schedulePersist(): void {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        if (!stateRef.current) return;
        const sid = useSenecaStore.getState().session.id;
        if (!sid) return;
        const json = JSON.stringify(stateRef.current);
        if (json === lastSavedJson.current) return;
        lastSavedJson.current = json;
        apiJson(`/api/sessions/${sid}/map`, {
          method: "PUT",
          body: stateRef.current,
        }).catch((err) => {
          console.warn("[seneca] map save failed", err);
        });
      }, DEBOUNCE_MS);
    }
    // mapRef + setMap are stable; sessionId is read fresh inside the persist
    // closure to avoid resetting the map when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── vision capture ───────────────────────────────────────────────────────

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const unregister = registerCapturer("map", async () => {
      try {
        return await htmlToImage.toBlob(host, {
          cacheBust: true,
          pixelRatio: window.devicePixelRatio || 1,
          backgroundColor: "#0e0a06",
        });
      } catch (err) {
        console.warn("[seneca] map capture failed", err);
        return null;
      }
    });
    return unregister;
  }, []);

  // ── invalidate size when this tab becomes visible again ──────────────────
  // Without this, switching to the map after starting on whiteboard leaves
  // tile gaps because Leaflet measured a 0×0 container at mount.
  const activeTab = useSenecaStore((s) => s.activeTab);
  useEffect(() => {
    if (activeTab !== "map") return;
    const m = mapRef.current;
    if (!m) return;
    requestAnimationFrame(() => m.invalidateSize());
  }, [activeTab]);

  // Persist on unmount in case a debounce is still pending.
  useEffect(() => {
    return () => {
      if (!saveTimer.current) return;
      window.clearTimeout(saveTimer.current);
      const sid = useSenecaStore.getState().session.id;
      if (!sid || !stateRef.current) return;
      apiJson(`/api/sessions/${sid}/map`, {
        method: "PUT",
        body: stateRef.current,
      }).catch(() => {
        // best-effort; nothing to do here
      });
    };
  }, [sessionId]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="absolute inset-0 bg-transparent"
        aria-label="World map"
      />
      <MapLayerSwitcher
        active={activeLayer}
        onChange={(layer) => {
          // Route through the bridge so user clicks and AI tool calls take
          // exactly the same code path.
          getMapApi()?.setLayer(layer);
        }}
      />
    </div>
  );
}

/**
 * Leaflet's `getLatLngs()` returns nested arrays for multi-polygons. We
 * flatten one level since our shape schema uses a single ring.
 */
function flattenLatLngs(
  v: L.LatLng | L.LatLng[] | L.LatLng[][] | L.LatLng[][][],
): L.LatLng[] {
  if (!Array.isArray(v)) return [v];
  const first = v[0];
  if (!Array.isArray(first)) return v as L.LatLng[];
  const inner = first as L.LatLng | L.LatLng[] | L.LatLng[][];
  if (Array.isArray(inner)) return (first as L.LatLng[][]).flat();
  return first as L.LatLng[];
}
