/**
 * Build the workspace snapshot attached to every /api/chat request.
 */

import type { WorkspaceContext } from "@seneca/shared";

import {
  getWhiteboardBackgroundColor,
  readResolvedTheme,
  recommendedStrokeForTheme,
} from "./whiteboardTheme";
import {
  buildSceneDigest,
  computeViewportBounds,
} from "./whiteboardScene";
import { getDiagramBridge } from "./diagramBridge";
import { diagramXmlDigest } from "./diagramXmlDigest";
import { useSenecaStore, visionModeFor } from "../store/seneca";

/** Cleared at the start of each turn; set when vision capture fails. */
let visionCaptureFailedForNextContext = false;

export function markVisionCaptureFailed(): void {
  visionCaptureFailedForNextContext = true;
}

export function consumeVisionCaptureFailed(): boolean {
  const v = visionCaptureFailedForNextContext;
  visionCaptureFailedForNextContext = false;
  return v;
}

export function buildWorkspaceContext(): WorkspaceContext {
  const state = useSenecaStore.getState();
  const uiTheme = readResolvedTheme();
  const bg = getWhiteboardBackgroundColor(uiTheme);
  const wb = state.whiteboard;
  const elements = wb?.elements;
  const elementCount = Array.isArray(elements) ? elements.length : 0;
  const appState = wb?.appState as Record<string, unknown> | undefined;
  const viewport = computeViewportBounds(appState);

  const ctx: WorkspaceContext = {
    activeTab: state.activeTab,
    vision: visionModeFor(state.vision),
    uiTheme,
    whiteboard: {
      backgroundColor: bg,
      recommendedStrokeColor: recommendedStrokeForTheme(uiTheme),
      elementCount,
      viewport,
      elements:
        elementCount > 0 && Array.isArray(elements)
          ? buildSceneDigest(elements)
          : undefined,
    },
    voice: {
      mode: state.voice.mode,
      muted: state.voice.muted,
    },
  };

  if (consumeVisionCaptureFailed()) {
    ctx.visionCaptureFailed = true;
  }

  const map = state.mapState;
  if (map) {
    ctx.map = {
      center: map.center,
      zoom: map.zoom,
      layer: map.layer,
      pinCount: map.pins.length,
      shapeCount: map.shapes.length,
      pins: map.pins.slice(0, 12).map((p) => ({
        lat: p.lat,
        lng: p.lng,
        ...(p.label ? { label: p.label } : {}),
      })),
    };
  }

  const diagrams = state.diagrams;
  const diagramsXml =
    state.activeTab === "diagrams"
      ? (getDiagramBridge()?.getLiveXml() ?? diagrams?.xml)
      : diagrams?.xml;
  if (diagramsXml) {
    const d = diagramXmlDigest(diagramsXml);
    ctx.diagrams = {
      cellCount: d.cellCount,
      labelDigest: d.labelDigest,
      hasContent: d.hasContent,
      vertexCount: d.vertexCount,
      edgeCount: d.edgeCount,
      vertices: d.vertices,
      edges: d.edges,
      bounds: d.bounds,
    };
  }

  const docs = state.documentsState;
  if (docs) {
    const active = docs.activeId
      ? docs.items.find((r) => r.id === docs.activeId)
      : undefined;
    ctx.documents = {
      activeDocumentId: docs.activeId,
      activeDocumentName: active?.name ?? null,
      activePage: active?.currentPage ?? null,
      pageCount: active?.pageCount ?? null,
      loadedDocumentNames: docs.items.map((r) => r.name),
      documents: docs.items.map((r) => ({
        id: r.id,
        name: r.name,
        ...(r.textStatus ? { textStatus: r.textStatus } : {}),
        ...(r.indexStatus ? { indexStatus: r.indexStatus } : {}),
        ...(r.origin ? { origin: r.origin } : {}),
      })),
    };
  }

  const web = state.webState;
  if (web) {
    ctx.web = {
      url: web.url,
      searchOverlayOpen: state.webSearchOverlayOpen ?? false,
    };
  }

  return ctx;
}
