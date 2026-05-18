/**
 * Defensive coalesce helpers for the JSONB columns on `sessions`.
 *
 * Sessions created before a column existed may come back without it, or
 * with a partial shape; downstream UI (CanvasContainer + tabs) crash
 * loudly if the structure isn't exact. Centralising the normalisation
 * here lets both the initial boot fetch in `AppShell` and the in-app
 * session switch in `SessionsModal` share the same hydration logic.
 */

import type { DocumentsState, MapState, WebState } from "@seneca/shared";
import {
  DEFAULT_DOCUMENTS_STATE,
  DEFAULT_MAP_STATE,
  DEFAULT_WEB_STATE,
} from "@seneca/shared";

export function normalizeMap(raw: unknown): MapState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MAP_STATE };
  const m = raw as Partial<MapState>;
  return {
    center:
      Array.isArray(m.center) &&
      m.center.length === 2 &&
      typeof m.center[0] === "number" &&
      typeof m.center[1] === "number"
        ? [m.center[0], m.center[1]]
        : DEFAULT_MAP_STATE.center,
    zoom:
      typeof m.zoom === "number" && Number.isFinite(m.zoom)
        ? m.zoom
        : DEFAULT_MAP_STATE.zoom,
    layer: m.layer === "satellite" ? "satellite" : "standard",
    pins: Array.isArray(m.pins) ? m.pins : [],
    shapes: Array.isArray(m.shapes) ? m.shapes : [],
  };
}

export function normalizeDocuments(raw: unknown): DocumentsState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DOCUMENTS_STATE };
  const d = raw as Partial<DocumentsState>;
  const items = Array.isArray(d.items)
    ? d.items.filter(
        (it): it is DocumentsState["items"][number] =>
          !!it &&
          typeof it === "object" &&
          typeof (it as { id?: unknown }).id === "string" &&
          typeof (it as { name?: unknown }).name === "string",
      )
    : [];
  const ids = new Set(items.map((it) => it.id));
  const activeId =
    typeof d.activeId === "string" && ids.has(d.activeId) ? d.activeId : null;
  return { items, activeId };
}

export function normalizeWeb(raw: unknown): WebState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_WEB_STATE };
  const w = raw as Partial<WebState>;
  const history = Array.isArray(w.history)
    ? w.history.filter((h): h is string => typeof h === "string")
    : [];
  const idx =
    typeof w.historyIndex === "number" && Number.isFinite(w.historyIndex)
      ? Math.max(-1, Math.min(history.length - 1, Math.floor(w.historyIndex)))
      : history.length - 1;
  return {
    url: typeof w.url === "string" ? w.url : null,
    history,
    historyIndex: idx,
  };
}
