/**
 * Structured `ToolResult.output` payloads for client-fulfilled tools.
 */

import type { WebSearchResult } from "@seneca/shared";

import { useSenecaStore } from "../store/seneca";

export function mapStateOutput() {
  const map = useSenecaStore.getState().mapState;
  if (!map) return { ok: true };
  return {
    center: map.center,
    zoom: map.zoom,
    layer: map.layer,
    pins: map.pins.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      ...(p.label ? { label: p.label } : {}),
    })),
    shapes: map.shapes.length,
  };
}

export function documentGoToPageOutput(
  page: number,
  documentId?: string,
) {
  const docs = useSenecaStore.getState().documentsState;
  const id = documentId ?? docs?.activeId ?? null;
  const rec = id ? docs?.items.find((d) => d.id === id) : undefined;
  return {
    documentId: id,
    page,
    pageCount: rec?.pageCount ?? null,
    name: rec?.name ?? null,
  };
}

export function webNavigateOutput(url: string) {
  return { url };
}

export function webSearchOutput(
  query: string,
  results: WebSearchResult[],
) {
  return {
    query,
    results: results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
    })),
  };
}
